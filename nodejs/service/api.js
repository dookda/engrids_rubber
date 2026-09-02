const express = require('express');
const app = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const unzipper = require('unzipper');
const shapefile = require('shapefile');
const fs = require('fs');
const path = require('path');

const bodyParser = require('body-parser');
const pathModule = require('path');

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

require('dotenv').config();
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ── UTM zone helper ──────────────────────────────────────────────────────────
// ประเทศไทยคาบเกี่ยว 2 โซน UTM (47N ~96-102°E, 48N ~102-108°E) ห้าม hardcode 32647
// อย่างเดียว — ต้องเลือกโซนจาก centroid ของ geometry ทุกครั้งที่คำนวณ/บันทึกพื้นที่จริง
function _utmCentroidLonLat(coords, type) {
    let x = 0, y = 0, total = 0;
    const addRing = (ring) => { for (const [lon, lat] of ring) { x += lon; y += lat; total++; } };
    if (type === 'Polygon') {
        for (const ring of coords) addRing(ring);
    } else if (type === 'MultiPolygon') {
        for (const polygon of coords) for (const ring of polygon) addRing(ring);
    }
    return total > 0 ? [x / total, y / total] : [null, null];
}

function getUtmSridFromGeoJSON(geometry) {
    if (!geometry || !geometry.coordinates) return 32647;
    const [lon, lat] = _utmCentroidLonLat(geometry.coordinates, geometry.type);
    if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) return 32647; // fallback
    const zone = Math.floor((lon + 180) / 6) + 1;
    const isNorthern = lat >= 0;
    return isNorthern ? 32600 + zone : 32700 + zone;
}

// SQL expression (ไม่ใช่ JS) สำหรับคำนวณ UTM SRID จาก centroid ของ geometry ที่ระบุ ใช้ตอนที่
// query ทำงานข้ามหลายแถวในตาราง (join/overlap) ซึ่งไม่มี geometry เดี่ยวจาก client ให้คำนวณใน JS ได้
// ประเทศไทยอยู่ซีกโลกเหนือทั้งหมดจึงไม่ต้องเช็ค lat >= 0
const UTM_SRID_SQL = (geomExpr) =>
    `(32600 + FLOOR((ST_X(ST_Centroid(${geomExpr})) + 180) / 6)::int + 1)`;

// ── Review history helpers ──────────────────────────────────────────────────
// ใช้ pool เสมอ (ไม่ใช้ transaction client) เพื่อไม่ให้ history หายไปถ้า rollback
let _reviewHistoryReady = false;
async function ensureReviewHistoryTable() {
    if (_reviewHistoryReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS review_history (
            id          SERIAL PRIMARY KEY,
            tb_name     TEXT NOT NULL,
            parent_id   INTEGER,
            sub_id      TEXT,
            check_area  TEXT,
            check_shape TEXT,
            remark      TEXT,
            remark_image TEXT,
            reviewer    TEXT,
            review_ts   TIMESTAMP WITHOUT TIME ZONE,
            reset_reason TEXT,
            reset_ts    TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
    `);
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE review_history ADD COLUMN remark_image TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
    `).catch(() => {});
    _reviewHistoryReady = true;
}

async function _saveHistoryRows(tb, rows, reason) {
    // ตรวจสอบว่า remark / remark_image column มีอยู่หรือไม่
    const colCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name IN ('remark','remark_image')`,
        [`reclass_${tb}`]
    ).catch(() => ({ rows: [] }));
    const presentCols = colCheck.rows.map(r => r.column_name);
    const hasRemark = presentCols.includes('remark');
    const hasRemarkImage = presentCols.includes('remark_image');

    let remarkMap = {};
    let remarkImageMap = {};
    if ((hasRemark || hasRemarkImage) && rows.length > 0) {
        try {
            const subIds = rows.map(r => r.sub_id).filter(Boolean);
            if (subIds.length > 0) {
                const placeholders = subIds.map((_, i) => `$${i + 1}`).join(',');
                const selectCols = ['sub_id'];
                if (hasRemark) selectCols.push('remark');
                if (hasRemarkImage) selectCols.push('remark_image');
                const remarkRows = await pool.query(
                    `SELECT ${selectCols.join(', ')} FROM reclass_${tb} WHERE sub_id IN (${placeholders})`,
                    subIds
                );
                remarkRows.rows.forEach(r => {
                    remarkMap[r.sub_id] = r.remark;
                    remarkImageMap[r.sub_id] = r.remark_image;
                });
            }
        } catch (_) {}
    }

    for (const row of rows) {
        await pool.query(
            `INSERT INTO review_history
             (tb_name, parent_id, sub_id, check_area, check_shape, remark, remark_image, reviewer, review_ts, reset_reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [tb, row.id, row.sub_id, row.check_area, row.check_shape,
             remarkMap[row.sub_id] || null, remarkImageMap[row.sub_id] || null, row.reviewer, row.review_ts, reason]
        );
    }
}

async function ensureReclassReviewColumns(tb) {
    const cols = [
        { name: 'check_area',     type: 'text' },
        { name: 'check_shape',    type: 'text' },
        { name: 'remark',         type: 'text' },
        { name: 'reviewer',       type: 'text' },
        { name: 'review_ts',      type: 'timestamp without time zone' },
        { name: 'user_remark',    type: 'text' },
        { name: 'user_remark_ts', type: 'timestamp without time zone' },
        { name: '"class_Area"',    type: 'numeric' },
        { name: 'remark_image',   type: 'text' },
        { name: 'topology_status',     type: 'text' },
        { name: 'topology_detail',     type: 'json' },
        { name: 'topology_checked_ts', type: 'timestamp without time zone' },
    ];
    for (const col of cols) {
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE reclass_${tb} ADD COLUMN ${col.name} ${col.type};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        `).catch(() => {});
    }
}

async function saveReviewHistoryById(_, tb, id, reason) {
    try {
        await ensureReviewHistoryTable();
        await ensureReclassReviewColumns(tb);
        const { rows } = await pool.query(
            `SELECT id, sub_id, check_area, check_shape, reviewer, review_ts
             FROM reclass_${tb}
             WHERE id = $1
               AND (check_area IS NOT NULL OR check_shape IS NOT NULL OR reviewer IS NOT NULL)`,
            [id]
        );
        if (rows.length > 0) await _saveHistoryRows(tb, rows, reason);
    } catch (e) {
        console.error('saveReviewHistoryById error:', e.message);
    }
}

async function saveReviewHistoryBySubId(_, tb, sub_id, reason) {
    try {
        await ensureReviewHistoryTable();
        await ensureReclassReviewColumns(tb);
        const { rows } = await pool.query(
            `SELECT id, sub_id, check_area, check_shape, reviewer, review_ts
             FROM reclass_${tb}
             WHERE sub_id = $1
               AND (check_area IS NOT NULL OR check_shape IS NOT NULL OR reviewer IS NOT NULL)`,
            [sub_id]
        );
        if (rows.length > 0) await _saveHistoryRows(tb, rows, reason);
    } catch (e) {
        console.error('saveReviewHistoryBySubId error:', e.message);
    }
}
// ───────────────────────────────────────────────────────────────────────────

// ── Topology QA (overlap between neighboring plots) ─────────────────────────
// เทียบเฉพาะแปลงอื่นในตารางเดียวกัน (reclass_{tb}) ไม่รวม shpall — ไม่เช็คระหว่าง
// sub_id พี่น้องของ id เดียวกัน (มาจากการ split เดียวกัน ซึ่งถูกการันตีให้ติดกันสนิทอยู่แล้ว)
//   subIds = null  → เช็คทั้งตาราง (ปุ่ม "เช็ค Topology ทั้งหมด" ในหน้า reclassdash)
//   subIds = [...] → เช็คเฉพาะ sub_id ที่ระบุ (auto-trigger ทันทีที่ worker save เรขาคณิต/split)
async function recomputeTopologyStatus(tb, subIds = null) {
    await ensureReclassReviewColumns(tb);

    let scope = subIds;
    if (scope) {
        // ขยาย scope ให้ครอบคลุมแปลงที่เกี่ยวข้องด้วยทั้งสองทาง เพื่อไม่ให้ overlay ทับ topology_detail
        // ของเพื่อนบ้านแบบไม่ครบถ้วน (recompute เฉพาะ sub_id ที่แก้ไข จะเห็นแค่ความสัมพันธ์ฝั่งเดียว):
        //  1) เพื่อนบ้านเดิมจาก topology_detail ที่บันทึกไว้ก่อนหน้า (เผื่อย้ายออกห่างแล้วต้องเคลียร์ flag เก่า)
        //  2) เพื่อนบ้านใหม่ที่พึ่งมาซ้อนทับจากตำแหน่งปัจจุบัน (ยังไม่เคยถูกบันทึกไว้)
        // sub_id ทุกตัวใน scope สุดท้ายจะถูก recompute แบบเต็ม (เทียบกับทั้งตาราง) ไม่ใช่แค่เทียบกับ subIds เดิม
        // จึงได้ topology_detail ที่ถูกต้องครบถ้วนของตัวเอง ไม่สูญหายความสัมพันธ์อื่นที่ไม่เกี่ยวกับการแก้ไขครั้งนี้
        const { rows: oldRows } = await pool.query(
            `SELECT topology_detail FROM reclass_${tb} WHERE sub_id = ANY($1::text[]) AND topology_detail IS NOT NULL`,
            [scope]
        );
        const relatedIds = new Set(scope);
        oldRows.forEach(r => (r.topology_detail || []).forEach(d => { if (d && d.sub_id) relatedIds.add(d.sub_id); }));

        const { rows: newNeighborRows } = await pool.query(
            `SELECT DISTINCT b.sub_id
             FROM reclass_${tb} a
             JOIN reclass_${tb} b
               ON a.sub_id <> b.sub_id
              AND a.id IS DISTINCT FROM b.id
              AND a.geom && b.geom
              AND ST_Intersects(a.geom, b.geom)
              AND NOT ST_Touches(a.geom, b.geom)
             WHERE a.sub_id = ANY($1::text[])`,
            [scope]
        );
        newNeighborRows.forEach(r => relatedIds.add(r.sub_id));

        scope = Array.from(relatedIds);
    }

    const resetSql = scope
        ? `UPDATE reclass_${tb} SET topology_status = 'ok', topology_detail = NULL, topology_checked_ts = NOW() WHERE sub_id = ANY($1::text[])`
        : `UPDATE reclass_${tb} SET topology_status = 'ok', topology_detail = NULL, topology_checked_ts = NOW()`;
    await pool.query(resetSql, scope ? [scope] : []);

    const scopeFilter = scope ? 'AND a.sub_id = ANY($1::text[])' : '';
    const params = scope ? [scope] : [];
    await pool.query(`
        WITH ranked AS (
            SELECT
                a.sub_id AS a_sub,
                b.sub_id AS b_sub,
                b.id AS b_id,
                ROUND(ST_Area(ST_Transform(ST_Intersection(a.geom, b.geom), ${UTM_SRID_SQL('a.geom')}))::numeric, 2) AS overlap_sqm
            FROM reclass_${tb} a
            JOIN reclass_${tb} b
              ON a.sub_id <> b.sub_id
             AND a.id IS DISTINCT FROM b.id
             AND a.geom && b.geom
             AND ST_Intersects(a.geom, b.geom)
             AND NOT ST_Touches(a.geom, b.geom)
            WHERE TRUE ${scopeFilter}
        ),
        agg AS (
            SELECT
                a_sub,
                json_agg(json_build_object('sub_id', b_sub, 'id', b_id, 'type', 'overlap', 'overlap_sqm', overlap_sqm)
                         ORDER BY overlap_sqm DESC NULLS LAST) AS detail
            FROM ranked
            GROUP BY a_sub
        )
        UPDATE reclass_${tb} r
        SET topology_status = 'overlap',
            topology_detail = agg.detail,
            topology_checked_ts = NOW()
        FROM agg
        WHERE r.sub_id = agg.a_sub
    `, params);

    return scope; // null = ทั้งตารางถูกประมวลผล
}
// ───────────────────────────────────────────────────────────────────────────

// get all users
app.get('/api/getfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Get all columns from the table
        const colsResult = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
            [tb]
        );

        if (colsResult.rowCount === 0) {
            return res.status(404).json({ error: 'Table not found' });
        }

        // Build SELECT clause with geometry columns converted to GeoJSON
        const columns = colsResult.rows.map(r => r.column_name);
        const selectColumns = columns.map(col => {
            if (col === 'geom' || col === 'geom_point') {
                return `ST_AsGeoJSON(${col}) AS ${col}`;
            }
            return `"${col}" AS "${col.toLowerCase()}"`;
        }).join(',\n');

        const sql = `SELECT ${selectColumns} FROM ${tb} WHERE geom IS NOT NULL OR geom_point IS NOT NULL`;

        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/getfeatures/:tb/:fid', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const fid = req.params.fid;
        console.log(`Fetching feature with ID: ${fid} from table: ${tb}`);
        if (!fid) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        // Check if reclass table exists
        const checkTableSql = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`;
        const reclassTableName = `reclass_${tb}`;
        const checkResult = await pool.query(checkTableSql, [reclassTableName]);
        const reclassTableExists = checkResult.rows[0].exists;

        // จุดอ้างอิงเดิม (GPS ก่อนขึ้นรูป) เก็บไว้ที่ตารางหลัก ไม่ใช่ทุกตารางจะมีคอลัมน์นี้ — เช็คก่อนเสมอ
        const geomPointColCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'geom_point'",
            [tb]
        );
        const geomPointSelect = geomPointColCheck.rowCount > 0
            ? 'ST_ASGeoJSON(t.geom_point) AS geom_point'
            : 'NULL::json AS geom_point';

        let sql, values;
        if (reclassTableExists) {
            sql = `SELECT r.id,
                        r.sub_id,
                        r.classtype,
                        r.shpsplit_sqm,
                        r."class_Area",
                        r.check_area,
                        r.check_shape,
                        r.remark,
                        r.reviewer,
                        t."Deed_Sqm",
                        t."Deed_Area",
                        t."Rubr_Sqm",
                        t."Rubr_total",
                        t."Deed_ID",
                        t."Full_nam",
                        t."Farmer_ID",
                        ST_ASGeoJSON(r.geom) AS geom,
                        ${geomPointSelect}
                    FROM ${reclassTableName} r
                    JOIN ${tb} t ON r.id = t.id
                    WHERE r.geom IS NOT NULL AND r.id = $1`;
            values = [fid];
        } else {
            // Fallback to original table (no reclass table yet)
            sql = `SELECT t.id,
                        t.id AS sub_id,
                        NULL AS classtype,
                        t."Sqm_Deed" AS shpsplit_sqm,
                        t."Deed_Sqm",
                        t."Deed_Area",
                        t."Rubr_Sqm",
                        t."Rubr_total",
                        t."Deed_ID",
                        t."Full_nam",
                        t."Farmer_ID",
                        ST_ASGeoJSON(t.geom) AS geom,
                        ${geomPointSelect}
                    FROM ${tb} t
                    WHERE t.geom IS NOT NULL AND t.id = $1`;
            values = [fid];
        }

        console.log(`Executing SQL: ${sql} with fid: ${fid}`);
        const result = await pool.query(sql, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// v3
app.get('/api/getfeaturesv3/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // ตรวจสอบคอลัมน์ geom_point
        const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'geom_point'",
            [tb]
        );
        const hasGeomPoint = colCheck.rowCount > 0;

        const geomPointSelect = hasGeomPoint ? 'ST_AsGeoJSON(t.geom_point) AS geom_point' : "NULL::json AS geom_point";
        const whereClause = hasGeomPoint ? 'WHERE t.geom IS NOT NULL OR t.geom_point IS NOT NULL' : 'WHERE t.geom IS NOT NULL';

        await ensurePlotLocksTable();

        const sql = `
            SELECT t.id,
                t."F_name",
                t."L_name",
                t."Para_Age",
                t.refinal,
                t."Farmer_ID",
                t."Regis_No",
                t."Deed_Sqm",
                t."Deed_Area",
                t."Deed_total",
                t."Deed_ID",
                t."Rubr_Sqm",
                t."Rubr_total",
                t."Full_nam",
                t."Sqm_Deed",
                t.classified,
                (pl.id IS NOT NULL) AS locked,
                ST_AsGeoJSON(t.geom) AS geom,
                ${geomPointSelect}
            FROM ${tb} t
            LEFT JOIN plot_locks pl ON LOWER(pl.tb_name) = LOWER($1) AND pl.feature_id = t.id
            ${whereClause}
        `;
        const result = await pool.query(sql, [tb]);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/deletefeature/:tb/:id', async (req, res) => {
    try {
        let { tb, id } = req.params;
        tb = tb.toLowerCase();

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'Feature ID must be a number' });
        }

        if (await blockIfLocked(req, res, tb, featureId)) return;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Delete from reclass table if it exists
            await client.query(`DELETE FROM reclass_${tb} WHERE id = $1`, [featureId]);
            // Delete from main table
            const result = await client.query(`DELETE FROM ${tb} WHERE id = $1 RETURNING id`, [featureId]);

            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Feature not found' });
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Feature deleted successfully', deletedId: result.rows[0].id });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error in /api/deletefeature:', err);
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/restorefeatures/:tb/:id', async (req, res) => {
    try {
        let { tb, id } = req.params;
        tb = tb.toLowerCase();

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'Feature ID must be a number' });
        }

        if (await blockIfLocked(req, res, tb, featureId)) return;

        // ──────────────────────────────────────────────────────────────────────
        // ลองดึงจาก backup table ก่อน (ค่าต้นฉบับ) ถ้ามี
        // ──────────────────────────────────────────────────────────────────────
        const backupExists = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );

        if (backupExists.rows[0].exists) {
            // ── Restore จาก backup table (ค่าต้นฉบับที่ upload ครั้งแรก) ──────
            const bkRow = await pool.query(
                `SELECT * FROM backup_${tb} WHERE id = $1 LIMIT 1`,
                [featureId]
            );
            if (bkRow.rowCount > 0) {
                const bk = bkRow.rows[0];
                const isPoint = bk.geom === null; // polygon จะมี geom, point จะเป็น NULL

                let updateSql, updateResult;
                if (isPoint) {
                    // ── Point: reset geom → NULL, restore geom_point ต้นฉบับ + Sqm_Deed ──
                    updateResult = await pool.query(`
                        UPDATE ${tb} AS t
                        SET geom         = NULL,
                            geom_point   = b.geom_point,
                            "Sqm_Deed"   = b."Sqm_Deed",
                            "Deed_Area"  = ROUND((b."Sqm_Deed" / 1600.0)::numeric, 2)
                        FROM backup_${tb} AS b
                        WHERE t.id = $1 AND b.id = $1
                        RETURNING t.*
                    `, [featureId]);
                } else {
                    // ── Polygon: restore geom + คำนวณ shparea_sq ใหม่ ────────
                    // คำนวณ EPSG จาก centroid ของ geometry ใน backup
                    const geomRow = await pool.query(
                        `SELECT ST_AsGeoJSON(geom) AS geom FROM backup_${tb} WHERE id = $1`,
                        [featureId]
                    );
                    const geojson = JSON.parse(geomRow.rows[0].geom);
                    function getPolygonCentroid(coords, type) {
                        let x = 0, y = 0, total = 0;
                        if (type === 'Polygon') {
                            for (const ring of coords) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                        } else if (type === 'MultiPolygon') {
                            for (const polygon of coords) for (const ring of polygon) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                        }
                        return total > 0 ? [x / total, y / total] : [null, null];
                    }
                    const [lon, lat] = getPolygonCentroid(geojson.coordinates, geojson.type);
                    const epsg = (lon !== null && !isNaN(lon))
                        ? (lat >= 0 ? 32600 : 32700) + Math.floor((lon + 180) / 6) + 1
                        : 4326;

                    updateResult = await pool.query(`
                        UPDATE ${tb} AS t
                        SET geom         = b.geom,
                            geom_point   = b.geom_point,
                            "Sqm_Deed"   = b."Sqm_Deed",
                            "Deed_Area"  = ROUND((b."Sqm_Deed" / 1600.0)::numeric, 2)
                        FROM backup_${tb} AS b
                        WHERE t.id = $1 AND b.id = $1
                        RETURNING t.*
                    `, [featureId]);
                }

                if (!updateResult || updateResult.rowCount === 0) {
                    return res.status(404).json({ error: 'Feature not found in main table' });
                }

                // sync shpsplit_sqm ใน reclass table ด้วย (ถ้ามี)
                const reclassCheck = await pool.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`reclass_${tb}`]
                );
                if (reclassCheck.rows[0].exists) {
                    if (isPoint) {
                        // Point: sync geom_point กลับต้นฉบับ + reset geom = NULL ใน reclass
                        await pool.query(`
                            UPDATE reclass_${tb}
                            SET shpsplit_sqm = $1, "class_Area" = ROUND(($1::numeric / 1600.0), 2),
                                geom        = NULL,
                                geom_point  = b.geom_point
                            FROM backup_${tb} AS b
                            WHERE reclass_${tb}.id = $2
                              AND b.id = $2
                              AND (reclass_${tb}.sub_id = $3 OR reclass_${tb}.sub_id = $2::text)
                        `, [bk['Sqm_Deed'], featureId, featureId.toString()]);
                    } else {
                        // Polygon: sync shpsplit_sqm เท่านั้น
                        await pool.query(`
                            UPDATE reclass_${tb}
                            SET shpsplit_sqm = $1, "class_Area" = ROUND(($1::numeric / 1600.0), 2)
                            WHERE id = $2 AND (sub_id = $3 OR sub_id = $2::text)
                        `, [bk['Sqm_Deed'], featureId, featureId.toString()]);
                    }

                    // Save review history before resetting
                    await saveReviewHistoryById(pool, tb, featureId, 'restore');
                    // Safely reset check fields if they exist
                    await pool.query(`
                        DO $$ BEGIN
                            UPDATE reclass_${tb}
                            SET check_area = NULL, check_shape = NULL, reviewer = NULL, review_ts = NULL
                            WHERE id = ${featureId} AND (sub_id = '${featureId.toString()}' OR sub_id = ${featureId}::text);
                        EXCEPTION WHEN undefined_column THEN NULL; END $$;
                    `);
                }

                return res.status(200).json({
                    success: true,
                    source: 'backup',
                    data: updateResult.rows[0]
                });
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        // Fallback: ไม่มี backup → restore จาก reclass table (พฤติกรรมเดิม)
        // รองรับทั้ง polygon (geom) และ point (geom_point)
        // ──────────────────────────────────────────────────────────────────────
        const geomRow = await pool.query(
            `SELECT ST_AsGeoJSON(geom) AS geom, ST_AsGeoJSON(geom_point) AS geom_point
             FROM reclass_${tb} WHERE id = $1 LIMIT 1`,
            [featureId]
        );
        if (geomRow.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in reclass table' });
        }

        const rGeom = geomRow.rows[0].geom;        // อาจ null ถ้าเป็น point
        const rGeomPt = geomRow.rows[0].geom_point;  // อาจ null ถ้าเป็น polygon
        const isPoint = rGeom === null;

        let sql, result;
        if (isPoint) {
            // ── Point: reset geom → NULL, restore geom_point จาก reclass ──
            sql = `
                UPDATE ${tb} AS t
                SET geom       = NULL,
                    geom_point = r.geom_point
                FROM reclass_${tb} AS r
                WHERE t.id = $1 AND r.id = $1
                RETURNING t.*
            `;
        } else {
            // ── Polygon: restore geom + คำนวณ shparea_sq ────────────────────
            const geojson = JSON.parse(rGeom);
            function getPolygonCentroid2(coords, type) {
                let x = 0, y = 0, total = 0;
                if (type === 'Polygon') {
                    for (const ring of coords) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                } else if (type === 'MultiPolygon') {
                    for (const polygon of coords) for (const ring of polygon) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                }
                return total > 0 ? [x / total, y / total] : [null, null];
            }
            const [lon, lat] = getPolygonCentroid2(geojson.coordinates, geojson.type);
            const epsg = (lon !== null && !isNaN(lon))
                ? (lat >= 0 ? 32600 : 32700) + Math.floor((lon + 180) / 6) + 1
                : 4326;

            sql = `
                UPDATE ${tb} AS t
                SET geom        = r.geom,
                    "Sqm_Deed"  = ST_Area(ST_Transform(r.geom, ${epsg})),
                    "Deed_Area" = ROUND((ST_Area(ST_Transform(r.geom, ${epsg})) / 1600.0)::numeric, 2)
                FROM reclass_${tb} AS r
                WHERE t.id = $1 AND r.id = $1
                RETURNING t.*
            `;
        }

        const { rows, rowCount } = await pool.query(sql, [featureId]);
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        return res.status(200).json({
            success: true,
            source: 'reclass',
            data: rows[0]
        });

    } catch (err) {
        console.error('Error in /api/restorefeatures:', err);
        return res.status(500).json({ error: err.message });
    }
});




app.post('/api/updatefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const { id, refinal, features, displayName, geometryChanged, currentShpareaSq } = req.body;

        if (!features || !Array.isArray(features) || features.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty features' });
        }

        if (await blockIfLocked(req, res, tb, parseInt(id, 10))) return;

        const client = await pool.connect();

        // ✅ ฟังก์ชันคำนวณ EPSG จาก centroid
        function getPolygonCentroid(coords, type) {
            let x = 0, y = 0, total = 0;

            if (type === 'Polygon') {
                for (const ring of coords) {
                    for (const [lon, lat] of ring) {
                        x += lon;
                        y += lat;
                        total++;
                    }
                }
            } else if (type === 'MultiPolygon') {
                for (const polygon of coords) {
                    for (const ring of polygon) {
                        for (const [lon, lat] of ring) {
                            x += lon;
                            y += lat;
                            total++;
                        }
                    }
                }
            }

            return total > 0 ? [x / total, y / total] : [null, null];
        }

        function getUTMEPSGCode(lon, lat) {
            const zone = Math.floor((lon + 180) / 6) + 1;
            return lat >= 0 ? 32600 + zone : 32700 + zone;
        }

        function getEPSGFromGeoJSON(geometry) {
            const coords = geometry.coordinates;
            const type = geometry.type;
            const [lon, lat] = getPolygonCentroid(coords, type);
            if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
                return 4326;
            }
            return getUTMEPSGCode(lon, lat);
        }

        try {
            await client.query('BEGIN');

            const areas = [];

            for (const feature of features) {
                const geometry = feature.geometry;

                // Reject empty/degenerate geometry (e.g. coordinates: [] left behind
                // after deleting every vertex) — Postgis stores these as an empty
                // geometry without erroring, which then breaks rendering on reload.
                if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'รูปร่างแปลงไม่ถูกต้อง (geometry ว่างเปล่า)' });
                }

                const geojsonStr = JSON.stringify(geometry);

                let area;
                if (geometryChanged) {
                    // ✅ คำนวณพื้นที่ใหม่เมื่อผู้ใช้แก้ไข geometry จริงๆ
                    const epsg = getEPSGFromGeoJSON(geometry);
                    const areaSql = `
                        SELECT ST_Area(
                            ST_Transform(
                                ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                                ${epsg}
                            )
                        ) AS area
                    `;
                    const areaResult = await client.query(areaSql, [geojsonStr]);
                    area = areaResult.rows[0].area;
                    console.log(`Geometry changed for ID ${id}, recalculating area: ${area}`);
                } else {
                    // ✅ ใช้ค่าจากฐานข้อมูลเดิม ไม่คำนวณใหม่ (ดึงจาก Sqm_Deed ซึ่งเก็บ m²)
                    const existingRes = await client.query(`SELECT "Sqm_Deed" FROM ${tb} WHERE id = $1`, [id]);
                    area = existingRes.rows[0]?.['Sqm_Deed'] || currentShpareaSq || 0;
                    console.log(`Geometry unchanged for ID ${id}, preserving area: ${area}`);
                }

                // ✅ บันทึกลงฐานข้อมูล
                // Sqm_Deed = เนื้อที่ขณะนี้ (m²), Deed_Area = เนื้อที่ขณะนี้ (ไร่)
                const areaRai = area / 1600.0;
                await client.query(`
                    UPDATE ${tb}
                    SET 
                        geom = CASE 
                            WHEN ST_GeometryType(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) IN ('ST_Polygon', 'ST_MultiPolygon') 
                            THEN ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
                            ELSE geom 
                        END,
                        geom_point = CASE
                            WHEN ST_GeometryType(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) = 'ST_Point'
                            THEN ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
                            ELSE geom_point
                        END,
                        "Sqm_Deed"  = $3,
                        "Deed_Area" = $6,
                        refinal = $4,
                        editor = $5
                    WHERE id = $2
                `, [
                    geojsonStr,
                    id,
                    area,
                    refinal,
                    displayName,
                    areaRai
                ]);

                // Reset review data in reclass table if it exists
                const reclassCheck = await client.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`reclass_${tb}`]
                );
                if (reclassCheck.rows[0].exists) {
                    await saveReviewHistoryById(client, tb, parseInt(id, 10), 'reshape');
                    await client.query(`
                        DO $$ BEGIN
                            UPDATE reclass_${tb}
                            SET check_area = NULL,
                                check_shape = NULL,
                                reviewer = NULL,
                                review_ts = NULL
                            WHERE id = ${parseInt(id, 10)};
                        EXCEPTION WHEN undefined_column THEN NULL; END $$;
                    `);
                }

                areas.push({
                    id: feature.properties?.id || id,
                    area
                });
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                updated: areas.map(a => a.id),
                areas
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error in /api/updatefeatures:', err);
        res.status(500).json({ error: err.message });
    }
});

// ล้าง geometry ของแปลง (กรณีผู้ใช้ลบ node จนรูปร่างไม่เหลือพื้นที่ ตั้งใจจะวาดใหม่จากจุดอ้างอิงเดิม)
app.put('/api/clearshape/:tb/:id', async (req, res) => {
    try {
        let { tb, id } = req.params;
        tb = tb.toLowerCase();

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'Feature ID must be a number' });
        }

        if (await blockIfLocked(req, res, tb, featureId)) return;

        const { refinal, displayName } = req.body;

        await pool.query(`
            UPDATE ${tb}
            SET geom = NULL,
                "Sqm_Deed" = 0,
                "Deed_Area" = 0,
                refinal = $2,
                editor = $3
            WHERE id = $1
        `, [featureId, refinal || '', displayName || null]);

        res.json({ success: true });
    } catch (err) {
        console.error('Error in /api/clearshape:', err);
        res.status(500).json({ error: err.message });
    }
});

// savefeature endpoint removed — was only used by digitize folder (deleted)


app.get('/api/getreclassfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Auto-add review columns if they don't exist (for older tables)
        // Rename legacy Rubr_Area column to class_Area if it exists
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE reclass_${tb} RENAME COLUMN "Rubr_Area" TO "class_Area";
            EXCEPTION
                WHEN undefined_column THEN NULL;
                WHEN undefined_table THEN NULL;
            END $$;
        `).catch(() => {});

        // Auto-add review columns if they don't exist (for older tables)
        const alterCols = ['check_area', 'check_shape', 'remark', 'reviewer', 'user_remark', 'review_ts', 'user_remark_ts', 'class_Area', 'remark_image', 'topology_status', 'topology_detail', 'topology_checked_ts'];
        for (const col of alterCols) {
            let colType = 'text';
            if (col === 'review_ts' || col === 'user_remark_ts' || col === 'topology_checked_ts') colType = 'timestamp without time zone';
            if (col === 'class_Area') colType = 'numeric';
            if (col === 'topology_detail') colType = 'json';
            let colName = col === 'class_Area' ? '"class_Area"' : col;
            await pool.query(`
                DO $$ BEGIN
                    ALTER TABLE reclass_${tb} ADD COLUMN ${colName} ${colType};
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END $$;
            `);
        }

        // class_Area ต้องเท่ากับ shpsplit_sqm/1600 เสมอ (คำนวณคู่กันทุกจุดที่ insert/update ปกติ)
        // sync ซ้ำทุกครั้งที่โหลดหน้านี้ ไม่ใช่แค่ตอน class_Area เป็น NULL เพราะบางจุด (เช่น รวม polygon)
        // เคย update shpsplit_sqm อย่างเดียวจนสองคอลัมน์ไม่ตรงกัน ทำให้ตัวเลขเพี้ยนไปจากที่อื่นที่อ่าน class_Area
        await pool.query(`
            UPDATE reclass_${tb}
            SET "class_Area" = ROUND((shpsplit_sqm / 1600.0), 2)
            WHERE shpsplit_sqm IS NOT NULL
              AND ("class_Area" IS NULL OR ABS("class_Area" - ROUND((shpsplit_sqm / 1600.0), 2)) > 0.005);
        `);

        // จุดอ้างอิงเดิม (GPS ก่อนขึ้นรูป) เก็บไว้ที่ตารางหลัก ไม่ใช่ทุกตารางจะมีคอลัมน์นี้ — เช็คก่อนเสมอ
        const geomPointColCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'geom_point'",
            [tb]
        );
        const geomPointSelect = geomPointColCheck.rowCount > 0
            ? 'ST_ASGeoJSON(b.geom_point) AS geom_point'
            : 'NULL::json AS geom_point';

        const sql = `SELECT a.id,
                    a.sub_id,
                    b.refinal,
                    a.classtype,
                    a.farmer_id,
                    b."Farmer_ID",
                    b."Regis_No",
                    b."F_name",
                    b."L_name",
                    b."Full_nam",
                    CONCAT_WS(' ', b."F_name", b."L_name") AS farm_name,
                    b."Para_Age",
                    b."Deed_ID",
                    b."Deed_Sqm",
                    b."Deed_Area",
                    b."Rubr_Sqm",
                    b."Rubr_total",
                    b."Sqm_Deed",
                    a.shpsplit_sqm,
                    a."class_Area",
                    a.check_area,
                    a.check_shape,
                    a.remark,
                    a.remark_image,
                    a.reviewer,
                    a.user_remark,
                    a.user_remark_ts,
                    a.review_ts,
                    a.ts,
                    a.topology_status,
                    a.topology_detail,
                    a.topology_checked_ts,
                    ST_ASGeoJSON(a.geom) AS geom,
                    ${geomPointSelect} FROM reclass_${tb} a
                LEFT JOIN ${tb} b
                ON a.id = b.id
                WHERE a.geom IS NOT NULL`;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Review/recheck endpoint
app.put('/api/update_review/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { sub_id, check_area, check_shape, remark, reviewer, user_remark, remark_image } = req.body;
        if (!sub_id) {
            return res.status(400).json({ error: 'sub_id is required' });
        }

        const sql = `
            UPDATE reclass_${tb}
            SET check_area = $1,
                check_shape = $2,
                remark = $3,
                reviewer = $4,
                review_ts = NOW(),
                remark_image = $5
            WHERE sub_id = $6
            RETURNING *`;

        const values = [check_area || null, check_shape || null, remark || null, reviewer || null, remark_image || null, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Clear review endpoint
app.put('/api/clear_review/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const { sub_id } = req.body;
        if (!tb || !sub_id) {
            return res.status(400).json({ error: 'Table name and sub_id are required' });
        }

        await saveReviewHistoryBySubId(pool, tb, sub_id, 'manual_clear');

        const sql = `
            UPDATE reclass_${tb}
            SET check_area = NULL,
                check_shape = NULL,
                remark = NULL,
                remark_image = NULL,
                reviewer = NULL,
                review_ts = NULL
            WHERE sub_id = $1
            RETURNING *`;

        const result = await pool.query(sql, [sub_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Topology QA — เช็คแปลงซ้อนทับทั้งตาราง (ปุ่ม "เช็ค Topology ทั้งหมด" ใน reclassdash)
app.post('/api/check_topology/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        await recomputeTopologyStatus(tb, null);

        const { rows } = await pool.query(
            `SELECT sub_id, topology_status, topology_detail, topology_checked_ts FROM reclass_${tb}`
        );
        const counts = rows.reduce((acc, r) => {
            const k = r.topology_status || 'ok';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, { overlap: 0, ok: 0 });

        res.status(200).json({ success: true, data: rows, counts });
    } catch (err) {
        console.error('check_topology error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Review history endpoint
app.get('/api/review_history/:tb/:id', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const id = parseInt(req.params.id, 10);
        if (!tb || isNaN(id)) return res.status(400).json({ error: 'Invalid parameters' });

        const exists = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'review_history')`
        );
        if (!exists.rows[0].exists) {
            return res.json({ success: true, data: [] });
        }

        const result = await pool.query(
            `SELECT * FROM review_history WHERE tb_name = $1 AND parent_id = $2 ORDER BY reset_ts DESC`,
            [tb, id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// User remark endpoint
app.put('/api/update_user_remark/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { sub_id, user_remark } = req.body;
        if (!sub_id) {
            return res.status(400).json({ error: 'sub_id is required' });
        }

        const sql = `
            UPDATE reclass_${tb}
            SET user_remark = $1,
                user_remark_ts = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END
            WHERE sub_id = $2
            RETURNING *`;

        const values = [user_remark || null, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload an annotated remark image (admin marks up a screenshot to show what needs fixing)
app.post('/api/upload_remark_image', async (req, res) => {
    try {
        const { image } = req.body;
        const matches = typeof image === 'string' && image.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ success: false, error: 'Invalid image data' });
        }
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');

        const dir = path.join(__dirname, '..', 'uploads', 'remark_images');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const fileName = `remark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        fs.writeFileSync(path.join(dir, fileName), buffer);

        res.status(200).json({ success: true, url: `/rub/uploads/remark_images/${fileName}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE a single reclass feature by sub_id
app.delete('/api/delete_reclass_feature/:tb/:sub_id', async (req, res) => {
    try {
        let { tb, sub_id } = req.params;
        tb = tb.toLowerCase();
        if (!tb || !sub_id) {
            return res.status(400).json({ error: 'Table name and sub_id are required' });
        }
        const sql = `DELETE FROM reclass_${tb} WHERE sub_id = $1 RETURNING sub_id`;
        const result = await pool.query(sql, [sub_id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Feature not found' });
        }
        res.status(200).json({ success: true, deleted: sub_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET shpall background polygons from PostgreSQL with bbox spatial filtering
app.get('/api/shpall/:tb', async (req, res) => {
    try {
        const bboxStr = req.query.bbox;
        if (!bboxStr) {
            return res.status(400).json({ success: false, error: 'bbox query param required: ?bbox=minX,minY,maxX,maxY' });
        }
        const parts = bboxStr.split(',').map(Number);
        if (parts.length !== 4 || parts.some(n => isNaN(n))) {
            return res.status(400).json({ success: false, error: 'invalid bbox' });
        }

        const sql = `
            SELECT ST_AsGeoJSON(geom) AS geom_json, farm_name, grow_rai, land_rai
            FROM public.shpall
            WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
            LIMIT 5000
        `;
        const result = await pool.query(sql, parts);
        const features = result.rows
            .filter(row => row.geom_json)
            .map(row => ({
                type: 'Feature',
                geometry: JSON.parse(row.geom_json),
                properties: {
                    farm_name: row.farm_name,
                    grow_rai: row.grow_rai,
                    land_rai: row.land_rai
                }
            }));

        res.status(200).json({ success: true, type: 'FeatureCollection', features });
    } catch (err) {
        console.error('Error in /api/shpall:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET shpall background polygons by farm_name search (ค้นหาแปลงยางเดิมจากชื่อ ไม่จำกัด bbox)
app.get('/api/shpall/:tb/search', async (req, res) => {
    try {
        const name = (req.query.name || '').trim();
        if (!name) {
            return res.status(400).json({ success: false, error: 'name query param required: ?name=...' });
        }

        const sql = `
            SELECT ST_AsGeoJSON(geom) AS geom_json, farm_name, grow_rai, land_rai
            FROM public.shpall
            WHERE farm_name ILIKE $1
            ORDER BY farm_name
            LIMIT 50
        `;
        const result = await pool.query(sql, [`%${name}%`]);
        const features = result.rows
            .filter(row => row.geom_json)
            .map(row => ({
                type: 'Feature',
                geometry: JSON.parse(row.geom_json),
                properties: {
                    farm_name: row.farm_name,
                    grow_rai: row.grow_rai,
                    land_rai: row.land_rai
                }
            }));

        res.status(200).json({ success: true, type: 'FeatureCollection', features });
    } catch (err) {
        console.error('Error in /api/shpall/search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET reshape polygon data for reclassdash map overlay
app.get('/api/getreshapefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const sql = `SELECT id,
                        "Farmer_ID",
                        "Deed_Sqm",
                        "Sqm_Deed",
                        ST_ASGeoJSON(geom) AS geom
                    FROM ${tb}
                    WHERE geom IS NOT NULL`;

        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/countsfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const query = `
        SELECT 
            (SELECT COUNT(*) FROM ${tb}) AS total,
            (SELECT COUNT(*) FROM ${tb} WHERE classified = TRUE) AS reclass,
            (
                CASE 
                    WHEN to_regclass('reclass_${tb}') IS NOT NULL THEN (
                        SELECT COUNT(DISTINCT r.id) 
                        FROM reclass_${tb} r
                        JOIN ${tb} m ON r.id = m.id
                        WHERE r.editor IS NOT NULL AND ABS(r.shpsplit_sqm - m."Deed_Sqm") <= 100
                    )
                    ELSE 0 
                END
            ) AS reshp
        `;
        const result = await pool.query(query);
        res.json(result.rows[0] || { total: 0, reclass: 0, reshp: 0 });
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.get('/api/countsrai/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const sql = `SELECT
                        classtype,
                        ROUND(SUM(shpsplit_sqm) / 1600.0, 0) AS area_rai
                    FROM ${tb}
                    GROUP BY classtype
                    ORDER BY classtype;`;
        const { rows } = await pool.query(sql);
        res.json(rows);
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.post('/api/create_reclass_feature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        const sub_id = id.toString();
        const sql = `
            WITH delete_existing AS (
                DELETE FROM reclass_${tb}
                WHERE id = $1
                RETURNING id
            )
            INSERT INTO reclass_${tb} (id, sub_id, farmer_id, shpsplit_sqm, "class_Area", geom)
            SELECT id, $2, "Farmer_ID", "Sqm_Deed", ROUND(("Sqm_Deed"::numeric / 1600.0), 2), geom
            FROM ${tb}
            WHERE id = $1
            RETURNING id, farmer_id, ST_AsGeoJSON(geom) AS geom;
        `;
        const values = [id, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in source table' });
        }

        // uudate reclass column
        const updateSql = `
            UPDATE ${tb}
            SET classified = FALSE
            WHERE id = $1
            RETURNING *;
        `;

        const updateValues = [id];
        const updateResult = await pool.query(updateSql, updateValues);
        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in reclass table' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/create_reclass_layer', async (req, res) => {
    try {
        const { tb } = req.body;
        console.log(tb);

        if (!tb) {
            return res.status(400).json({ error: 'table name are required' });
        }

        const sql = `CREATE TABLE reclass_${tb} (
                fid serial not null,
                id integer,
                sub_id text COLLATE pg_catalog."default",
                id_farmer text COLLATE pg_catalog."default",
                shpsplit_sqm numeric,
                "class_Area" numeric,
                "class_Area" numeric,
                geom geometry(MultiPolygon,4326),
                classtype text COLLATE pg_catalog."default",
                editor text COLLATE pg_catalog."default",
                check_area text COLLATE pg_catalog."default",
                check_shape text COLLATE pg_catalog."default",
                remark text COLLATE pg_catalog."default",
                reviewer text COLLATE pg_catalog."default",
                ts timestamp without time zone DEFAULT now()
            )`;
        await pool.query(sql);

        console.log(sql);

        // join reclass table to source table
        const sql2 = `CREATE VIEW v_reclass_${tb} AS SELECT
                    a.id,
                    a.farm_name,
                    a.farm_idc,
                    a.id_farmer,
                    a.land_seq,
                    a.land_right,
                    a.land_name,
                    a.land_moo,
                    a.land_vill,
                    a.tambon,
                    a.amphur,
                    a.province,
                    a.grow_year,
                    a.rip_type,
                    a.rubber_age,
                    a.grow_area,
                    a.regis_no,
                    a.no_plot,
                    a.id_farmer_    AS farmer_id,
                    a.titl_nam      AS title_name,
                    a.f_name        AS first_name,
                    a.l_name        AS last_name,
                    a.address,
                    a.sub_dis       AS sub_district,
                    a.district,
                    a.province_1    AS province_alt,
                    a.status,
                    a.title_no,
                    a.title_type,
                    a.rai,
                    a.age,
                    a.x,
                    a.y,
                    a.sqm_pacel,
                    a.chk,
                    a.diff_chk,
                    a.remark        AS a_remark,
                    a.refinal       AS a_refinal,
                    a.editor        AS a_editor,
                    a.ts            AS a_ts,
                    a.classified,
                    a.shparea_sq,
                    r.fid           AS reclass_fid,
                    r.id            AS reclass_parent_id,
                    r.sub_id        AS reclass_sub_id,
                     r.id_farmer     AS reclass_id_farmer,
                    r.shpsplit_sqm,
                    r."class_Area",
                    r.classtype,
                    r.editor        AS reclass_editor,
                    r.ts            AS r_ts,
                    r.geom
                FROM ${tb} AS a
                JOIN reclass_${tb} AS r
                ON a.id = r.id;`;
        await pool.query(sql2);

        console.log(sql2);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });

    }
})

app.post('/api/splitfeature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { polygon_fc, line_fc, displayName } = req.body;
        const polygon = polygon_fc.geometry;
        const line = line_fc.geometry;
        const properties = polygon_fc.properties;
        const id = polygon_fc.properties.id;
        const sub_id = polygon_fc.properties.sub_id;
        // เลือกโซน UTM จาก centroid ของแปลงจริงเสมอ (ไม่รับ srid จาก client) — ไทยมีทั้งโซน 47N/48N
        const srid = getUtmSridFromGeoJSON(polygon);

        console.log(`Splitting feature in table ${tb} with ID ${id} and sub_id ${sub_id}, UTM SRID ${srid}`);

        // Save review history before deleting the existing sub_id row
        await saveReviewHistoryBySubId(null, tb, sub_id, 'split');

        if (!properties?.Farmer_ID) {
            return res.status(400).json({ error: 'Farmer_ID is required in properties' });
        }
        if (!polygon?.type || !['Polygon', 'MultiPolygon'].includes(polygon.type) || !polygon.coordinates) {
            return res.status(400).json({ error: 'Invalid polygon GeoJSON' });
        }
        if (!line?.type || !['LineString', 'MultiLineString'].includes(line.type) || !line.coordinates) {
            return res.status(400).json({ error: 'Invalid line GeoJSON' });
        }

        const result = await pool.query(`
            WITH delete_existing AS (
                DELETE FROM reclass_${tb} 
                WHERE sub_id = $5
                RETURNING sub_id
            ),
            inputs AS (
                SELECT 
                    ST_Force2D(ST_GeomFromGeoJSON($1))     AS poly_4326,
                    ST_Force2D(ST_GeomFromGeoJSON($2))     AS line_4326,
                    $3::integer                             AS processing_srid
            ),
            -- Project to metric CRS for snapping
            projected AS (
                SELECT
                    ST_Transform(poly_4326, 3857)  AS poly_m,
                    ST_Transform(line_4326, 3857)  AS line_m,
                    poly_4326,
                    processing_srid
                FROM inputs
            ),
            -- Snap line onto polygon boundary (3 m tolerance)
            -- This fixes gap issues while preserving all intermediate vertices
            snapped AS (
                SELECT
                    poly_4326,
                    processing_srid,
                    ST_Transform(
                        ST_Snap(line_m, poly_m, 3.0),
                        4326
                    ) AS line_snapped
                FROM projected
            ),
            -- Split the polygon (both sides share common boundary = zero gap)
            split AS (
                SELECT
                    ST_Split(
                        ST_MakeValid(poly_4326),
                        line_snapped
                    ) AS split_geom,
                    processing_srid
                FROM snapped
            ),
            parts AS (
                SELECT
                    ST_MakeValid((ST_Dump(split_geom)).geom) AS geom_4326,
                    processing_srid
                FROM split
            ),
            calc_areas AS (
                SELECT
                    geom_4326,
                    ST_Area(ST_Transform(geom_4326, processing_srid)) AS raw_area
                FROM parts
                WHERE ST_GeometryType(geom_4326) IN ('ST_Polygon', 'ST_MultiPolygon')
                  AND ST_IsValid(geom_4326)
                  AND ST_Area(ST_Transform(geom_4326, processing_srid)) > 1.0
            ),
            totals AS (
                SELECT NULLIF(SUM(raw_area), 0) AS sum_raw FROM calc_areas
            ),
            proportional AS (
                SELECT
                    geom_4326,
                    raw_area,
                    (COALESCE($9::numeric, sum_raw) * (raw_area / sum_raw)) AS part_area,
                    ROW_NUMBER() OVER (ORDER BY raw_area DESC) AS rn
                FROM calc_areas CROSS JOIN totals
            ),
            final_areas AS (
                SELECT
                    geom_4326,
                    CASE
                        WHEN rn = 1 THEN part_area + (
                            COALESCE($9::numeric, (SELECT sum_raw FROM totals)) 
                            - SUM(part_area) OVER()
                        )
                        ELSE part_area
                    END AS allocated_area
                FROM proportional
            ),
            inserted AS (
                INSERT INTO reclass_${tb} (farmer_id, geom, sub_id, id, classtype, shpsplit_sqm, "class_Area", editor)
                SELECT
                    $4,
                    ST_Multi(geom_4326),
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7,
                    allocated_area,
                    ROUND((allocated_area::numeric / 1600.0), 2),
                    $8
                FROM final_areas
                RETURNING *
            )
            SELECT id, sub_id, classtype, farmer_id, shpsplit_sqm, "class_Area",
                   ST_AsGeoJSON(geom, 15) AS geom
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.Farmer_ID,
            sub_id,
            id,
            properties.Classtype,
            displayName,
            properties.shpsplit_sqm || null
        ]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'No split results — ตรวจสอบว่าเส้นตัดข้ามแปลงจริงหรือไม่' });
        }

        const newSubIds = result.rows.map(r => r.sub_id);
        await recomputeTopologyStatus(tb, newSubIds);
        const { rows: topoRows } = await pool.query(
            `SELECT sub_id, topology_status, topology_detail, topology_checked_ts
             FROM reclass_${tb} WHERE sub_id = ANY($1::text[])`,
            [newSubIds]
        );

        res.status(200).json({ success: true, data: result.rows, topology: topoRows });

    } catch (err) {
        console.error('Split error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Ensure valid intersecting geometries'
        });
    }
});

// ── Auto Farmer_ID: จองเลขทะเบียนเกษตรกรชั่วคราว ──────────────────────────
// ใช้เฉพาะตอนแปลงไม่มี Farmer_ID มาจับคู่ (เช่น plot ที่ id ไม่ตรงกับตาราง main)
// เพื่อให้ split ผ่านการตรวจสอบของ backend ได้ — ไม่ใช่การบันทึก Farmer_ID จริงลงตารางข้อมูล
// เก็บแค่ "เลขที่จองไปแล้ว" ไว้กันชนกัน เวลามีหลายคน/หลายเครื่อง/หลายแท็บทำงานพร้อมกัน
async function ensureAutoFarmerIdRegistryTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_farmer_id_registry (
            tb         text NOT NULL,
            plot_id    text NOT NULL,
            farmer_id  text NOT NULL,
            created_at timestamp DEFAULT NOW(),
            PRIMARY KEY (tb, plot_id),
            UNIQUE (tb, farmer_id)
        )
    `);
}

function hashToIntServer(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash * 33) ^ str.charCodeAt(i)) >>> 0; // djb2 variant, unsigned 32-bit
    }
    return hash;
}

app.post('/api/auto-farmer-id/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }
        const { id } = req.body;
        if (id === undefined || id === null || String(id).trim() === '') {
            return res.status(400).json({ error: 'id is required' });
        }
        const plotId = String(id).trim();

        await ensureAutoFarmerIdRegistryTable();

        const existing = await pool.query(
            `SELECT farmer_id FROM auto_farmer_id_registry WHERE tb = $1 AND plot_id = $2`,
            [tb, plotId]
        );
        if (existing.rowCount > 0) {
            return res.json({ success: true, farmer_id: existing.rows[0].farmer_id });
        }

        let seed = plotId;
        for (let attempt = 0; attempt < 50; attempt++) {
            const n = hashToIntServer(seed);
            const candidate = String(1000000000 + (n % 9000000000));

            const clash = await pool.query(
                `SELECT 1 FROM ${tb} WHERE "Farmer_ID" = $1
                 UNION ALL
                 SELECT 1 FROM auto_farmer_id_registry WHERE tb = $2 AND farmer_id = $1
                 LIMIT 1`,
                [candidate, tb]
            );
            if (clash.rowCount > 0) {
                seed = candidate;
                continue;
            }

            try {
                await pool.query(
                    `INSERT INTO auto_farmer_id_registry (tb, plot_id, farmer_id) VALUES ($1, $2, $3)`,
                    [tb, plotId, candidate]
                );
                return res.json({ success: true, farmer_id: candidate });
            } catch (e) {
                if (e.code === '23505') {
                    // ชนกันแบบ race condition — เช็คว่ามีคนจองให้ plot นี้ไปแล้วหรือยัง
                    const again = await pool.query(
                        `SELECT farmer_id FROM auto_farmer_id_registry WHERE tb = $1 AND plot_id = $2`,
                        [tb, plotId]
                    );
                    if (again.rowCount > 0) {
                        return res.json({ success: true, farmer_id: again.rows[0].farmer_id });
                    }
                    seed = candidate;
                    continue;
                }
                throw e;
            }
        }

        return res.status(500).json({ error: 'ไม่สามารถสร้างเลขที่ไม่ซ้ำได้' });
    } catch (err) {
        console.error('auto-farmer-id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Unsplit: คืนแปลงเดิม (ลบแถว split ทั้งหมด แล้ว re-insert ต้นฉบับ) ──
app.post('/api/unsplit_feature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }
        const { id, displayName } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }
        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'id must be a number' });
        }

        // Save review history for all split rows before deleting
        await saveReviewHistoryById(null, tb, featureId, 'unsplit');

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1) ลบแถวใน reclass ที่เป็น split-children ทั้งหมดของ id นี้
            await client.query(
                `DELETE FROM reclass_${tb} WHERE id = $1`,
                [featureId]
            );

            // 2) Re-insert แปลงเดิมจาก main table (sub_id = id.toString())
            const inserted = await client.query(`
                INSERT INTO reclass_${tb} (id, sub_id, farmer_id, shpsplit_sqm, "class_Area", geom, classtype, editor)
                SELECT id,
                       id::text AS sub_id,
                       "Farmer_ID",
                       "Sqm_Deed" AS shpsplit_sqm,
                       ROUND(("Sqm_Deed"::numeric / 1600.0), 2) AS "class_Area",
                       ST_Multi(geom) AS geom,
                       NULL AS classtype,
                       $2 AS editor
                FROM ${tb}
                WHERE id = $1
                RETURNING id, sub_id, classtype, farmer_id, shpsplit_sqm,
                          ST_AsGeoJSON(geom, 15) AS geom
            `, [featureId, displayName || null]);

            if (inserted.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Original feature not found in main table' });
            }

            await client.query('COMMIT');
            res.status(200).json({ success: true, data: inserted.rows });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Unsplit error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/update_landuse/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { id, sub_id, classtype, displayName } = req.body;
        if (!sub_id || !classtype) {
            return res.status(400).json({ error: 'ID and classtype are required' });
        }

        const updateReclass = `
            UPDATE reclass_${tb}
            SET classtype = $1, 
                editor = $2
            WHERE sub_id = $3
            RETURNING *`;

        const values = [classtype, displayName, sub_id];
        const result = await pool.query(updateReclass, values);

        await saveReviewHistoryBySubId(pool, tb, sub_id, 'update_landuse');
        await pool.query(`
            DO $$ BEGIN
                UPDATE reclass_${tb}
                SET check_area = NULL, check_shape = NULL, reviewer = NULL, review_ts = NULL
                WHERE sub_id = '${sub_id.replace(/'/g, "''")}';
            EXCEPTION WHEN undefined_column THEN NULL; END $$;
        `);

        const updateReshape = `
            UPDATE ${tb}
            SET classified = TRUE
            WHERE id = $1
            RETURNING *;
        `;
        const updateReshapeValues = [id];
        const updateResult = await pool.query(updateReshape, updateReshapeValues);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// //reclassify   
app.put('/api/update_geometry/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const { sub_id, geometry, displayName } = req.body;

        if (!geometry || !sub_id) {
            return res.status(400).json({ error: 'sub_id และ geometry จำเป็นต้องมี' });
        }

        const utmSrid = getUtmSridFromGeoJSON(geometry); // 32647 หรือ 32648 ตามตำแหน่งจริงของแปลง

        const query = `
            WITH geom_input AS (
                SELECT
                    ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom_wgs,
                    $2::text AS editor,
                    $3::text AS sub_id
            )
            UPDATE reclass_${tb}
            SET
                geom = CASE
                    WHEN ST_GeometryType(g.geom_wgs) IN ('ST_Polygon', 'ST_MultiPolygon')
                    THEN ST_Multi(g.geom_wgs)
                    ELSE geom
                END,
                geom_point = CASE
                    WHEN ST_GeometryType(g.geom_wgs) = 'ST_Point'
                    THEN g.geom_wgs
                    ELSE geom_point
                END,
                shpsplit_sqm = ST_Area(ST_Transform(g.geom_wgs, ${utmSrid})),
                "class_Area" = ROUND((ST_Area(ST_Transform(g.geom_wgs, ${utmSrid}))::numeric / 1600.0), 2),
                editor = g.editor
            FROM geom_input g
            WHERE reclass_${tb}.sub_id = g.sub_id
            RETURNING *;
        `;

        const values = [JSON.stringify(geometry), displayName, sub_id];
        const result = await pool.query(query, values);

        await saveReviewHistoryBySubId(pool, tb, sub_id, 'update_geometry');
        await pool.query(`
            DO $$ BEGIN
                UPDATE reclass_${tb}
                SET check_area = NULL, check_shape = NULL, reviewer = NULL, review_ts = NULL
                WHERE sub_id = '${sub_id.replace(/'/g, "''")}';
            EXCEPTION WHEN undefined_column THEN NULL; END $$;
        `);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบข้อมูล sub_id นี้' });
        }

        await recomputeTopologyStatus(tb, [sub_id]);
        const { rows: topoRows } = await pool.query(
            `SELECT topology_status, topology_detail, topology_checked_ts FROM reclass_${tb} WHERE sub_id = $1`,
            [sub_id]
        );

        res.status(200).json({ success: true, data: result.rows, topology: topoRows[0] || null });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});




app.get('/api/download/reshape/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const typeFilter = req.query.type; // 'rubber' or 'all_rubber'
        // ผู้ทำงาน (editor) ที่ต้องการกรองเฉพาะแปลงของคนนั้น — ใช้ตอน Download รายคนจากหน้าคำนวณค่าจ้าง (V1/V3)
        const editorFilter = req.query.editor ? String(req.query.editor).trim() : '';
        if (!tb) return res.status(400).json({ error: 'Table name is required' });

        let sql;
        const params = [];
        // ─── Case 1: Download reclassify (v_reclass_xxx) ───────────────────────────
        if (tb.startsWith('v_reclass_')) {
            const baseTb = tb.replace('v_reclass_', '');
            let extraTypeCondition = '';
            if (typeFilter === 'rubber') {
                extraTypeCondition = `AND LOWER(TRIM(r.classtype)) = 'rubber'`;
            } else if (typeFilter === 'rubber_and_ex') {
                extraTypeCondition = `AND LOWER(TRIM(r.classtype)) IN ('rubber', 'ex_age_rubber', 'ex_building', 'ex_pond', 'ex_cr_area', 'ex_ar_area', 'ex_other')`;
            }
            let extraEditorCondition = '';
            if (editorFilter) {
                params.push(editorFilter);
                extraEditorCondition = `AND r.editor = $${params.length}`;
            }

            sql = `
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(json_agg(f.feat ORDER BY f.regis_no NULLS LAST) FILTER (WHERE f.feat IS NOT NULL), '[]'::json)
                ) AS geojson
                FROM (
                    SELECT json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(r.geom)::json,
                        'properties', json_build_object(
                            'Classtype',    CASE r.classtype
                                                WHEN 'rubber' THEN 'ยางพาราที่ลงทะเบียน'
                                                WHEN 'not-rubber' THEN 'ยางพาราที่ไม่ได้ลงทะเบียน'
                                                WHEN 'Other' THEN 'ไม่ใช่ยางพารา'
                                                WHEN 'ex_age_rubber' THEN 'พื้นที่กันออก (ยางพาราต่างอายุ)'
                                                WHEN 'ex_building' THEN 'พื้นที่กันออก (สิ่งปลูกสร้าง)'
                                                WHEN 'ex_pond' THEN 'พื้นที่กันออก (บ่อน้ำ)'
                                                WHEN 'ex_cr_area' THEN 'พื้นที่กันออก (ถนนคอนกรีต)'
                                                WHEN 'ex_ar_area' THEN 'พื้นที่กันออก (ถนนลาดยาง)'
                                                WHEN 'ex_other' THEN 'พื้นที่กันออก (เพิ่มเติม)'
                                                ELSE r.classtype
                                            END,
                            'Class_Area',   r."class_Area",
                            'id',           r.id,
                            'Farmer_ID',    TRANSLATE(m."Farmer_ID"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Regis_No',     TRANSLATE(m."Regis_No"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'No_Plot',      TRANSLATE(m."No_Plot"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Title_name',   m."Title_name",
                            'F_name',       m."F_name",
                            'L_name',       m."L_name",
                            'Full_nam',     m."Full_nam",
                            'Address',      TRANSLATE(m."Address"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Sub_Dis',      m."Sub_Dis",
                            'District',     m."District",
                            'Province',     m."Province",
                            'F_Status',     m."F_Status",
                            'Deed_ID',      TRANSLATE(m."Deed_ID"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Deed_Type',    m."Deed_Type",
                            'Rubr_Rai',     m."Rubr_Rai",
                            'Rubr_Ngan',    m."Rubr_Ngan",
                            'Rubr_sqwa',    m."Rubr_sqwa",
                            'Rubr_total',   m."Rubr_total",
                            'Deed_Rai',     m."Deed_Rai",
                            'Deed_Ngan',    m."Deed_Ngan",
                            'Deed_sqwa',    m."Deed_sqwa",
                            'Deed_total',   m."Deed_total",
                            'Para_Age',     TRANSLATE(m."Para_Age"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'X',            m."X",
                            'Y',            m."Y",
                            'Deed_Area',    m."Deed_Area",
                            'editor',       r.editor,
                            'ts',           r.ts
                        )
                    ) AS feat,
                    m."Regis_No" AS regis_no
                    FROM reclass_${baseTb} r
                    JOIN ${baseTb} m ON r.id = m.id
                    WHERE r.geom IS NOT NULL AND r.classtype IS NOT NULL AND TRIM(r.classtype) <> '' ${extraTypeCondition} ${extraEditorCondition}
                ) f;
            `;
        }
        // ─── Case 2: Download แปลงยาง (Main Table) ─────────────────────────────────
        else {
            sql = `
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(json_agg(f.feat ORDER BY f.regis_no NULLS LAST) FILTER (WHERE f.feat IS NOT NULL), '[]'::json)
                ) AS geojson
                FROM (
                    SELECT json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(m.geom)::json,
                        'properties', json_build_object(
                            'id',           m.id,
                            'Farmer_ID',    TRANSLATE(m."Farmer_ID"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Regis_No',     TRANSLATE(m."Regis_No"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'No_Plot',      TRANSLATE(m."No_Plot"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Title_name',   m."Title_name",
                            'F_name',       m."F_name",
                            'L_name',       m."L_name",
                            'Full_nam',     m."Full_nam",
                            'Address',      TRANSLATE(m."Address"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Sub_Dis',      m."Sub_Dis",
                            'District',     m."District",
                            'Province',     m."Province",
                            'F_Status',     m."F_Status",
                            'Deed_ID',      TRANSLATE(m."Deed_ID"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Deed_Type',    m."Deed_Type",
                            'Rubr_Rai',     m."Rubr_Rai",
                            'Rubr_Ngan',    m."Rubr_Ngan",
                            'Rubr_sqwa',    m."Rubr_sqwa",
                            'Rubr_total',   m."Rubr_total",
                            'Deed_Rai',     m."Deed_Rai",
                            'Deed_Ngan',    m."Deed_Ngan",
                            'Deed_sqwa',    m."Deed_sqwa",
                            'Deed_total',   m."Deed_total",
                            'Para_Age',     TRANSLATE(m."Para_Age"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'X',            m."X",
                            'Y',            m."Y",
                            'Deed_Area',    m."Deed_Area",
                            'editor',       m.editor,
                            'ts',           m.ts
                        )
                    ) AS feat,
                    m."Regis_No" AS regis_no
                    FROM ${tb} m
                    WHERE m.geom IS NOT NULL
                ) f;
            `;
        }

        const { rows } = await pool.query(sql, params);
        const geojson = rows[0]?.geojson || { type: 'FeatureCollection', features: [] };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${tb}.geojson"`);
        res.send(JSON.stringify(geojson));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

async function ensureUsersTable() {
    const { rows } = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')`
    );
    if (!rows[0].exists) {
        await pool.query(`
            CREATE TABLE users (
                id           SERIAL PRIMARY KEY,
                google_id    TEXT UNIQUE,
                display_name TEXT,
                email        TEXT,
                photo        TEXT,
                role         TEXT NOT NULL DEFAULT 'worker',
                created_at   TIMESTAMP DEFAULT NOW()
            )
        `);
    } else {
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker'
        `);
    }
}

async function ensureTaskAssignmentColumns() {
    await pool.query(`ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS user_id INTEGER`);
    await pool.query(`ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS assignee_email TEXT`);
    // กำหนดส่งงาน (ไม่บังคับ) — ผูกกับ assignment แต่ละช่วง ID ไม่ใช่ผูกกับคน เพราะคนเดียวกันอาจมีหลายช่วง ID คนละเดดไลน์
    await pool.query(`ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS due_date DATE`);
    // Backfill user_id และ assignee_email สำหรับ assignment เก่าที่ยังไม่มีข้อมูล
    // (จับคู่ด้วย display_name เมื่อมีผู้ใช้ชื่อตรงกันเพียงคนเดียว)
    pool.query(`
        UPDATE task_assignments ta
        SET user_id = u.id,
            assignee_email = u.email
        FROM users u
        WHERE ta.user_id IS NULL
          AND ta.assignee_email IS NULL
          AND LOWER(u.display_name) = LOWER(ta.assignee_name)
          AND (SELECT COUNT(*) FROM users u2
               WHERE LOWER(u2.display_name) = LOWER(ta.assignee_name)) = 1
    `).catch(e => console.error('[BACKFILL-ASSIGN]', e.message));
}

app.get('/api/users', async (req, res) => {
    try {
        await ensureUsersTable();
        const result = await pool.query(
            `SELECT id, display_name, email, photo, role, created_at FROM users ORDER BY created_at`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
})

/* PUT /api/users/:id/role  – เปลี่ยน role ของ user (admin ใช้) */
app.put('/api/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!['admin', 'worker'].includes(role)) {
            return res.status(400).json({ error: 'role ต้องเป็น admin หรือ worker' });
        }
        await ensureUsersTable();
        const result = await pool.query(
            `UPDATE users SET role=$1 WHERE id=$2 RETURNING id, display_name, email, role`,
            [role, parseInt(id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

/* GET /api/my-assignment/:tb  – ดึง assignment ทั้งหมดของผู้ login อยู่ สำหรับ table นั้น (1 อีเมลอาจมีหลายช่วง ID) */
app.get('/api/my-assignment/:tb', async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        if (!sessionUser) return res.status(401).json({ error: 'Not authenticated' });

        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();

        const tb = req.params.tb.toLowerCase();
        const result = await pool.query(
            `SELECT * FROM task_assignments
             WHERE LOWER(tb_name) = $1
               AND (
                 user_id = $2
                 OR LOWER(assignee_email) = LOWER($3)
                 OR (user_id IS NULL AND LOWER(assignee_name) = LOWER($4))
               )
             ORDER BY id_from`,
            [tb, sessionUser.id, sessionUser.email || '', sessionUser.displayName || '']
        );
        const rows = result.rows;
        // Backfill user_id และ email ทันทีที่เจอ เพื่อให้ครั้งต่อไปค้นด้วย id/email ได้เลย
        const toBackfill = rows.filter(row => sessionUser.email && (!row.user_id || !row.assignee_email));
        if (toBackfill.length) {
            pool.query(
                `UPDATE task_assignments SET user_id = $1, assignee_email = $2
                 WHERE id = ANY($3::int[])`,
                [sessionUser.id, sessionUser.email, toBackfill.map(r => r.id)]
            ).catch(e => console.error('[BACKFILL-ROW]', e.message));
        }
        // คง field "data" เป็น row เดียวไว้เพื่อ backward-compat (ใช้ตัวแรก) และเพิ่ม "list" เป็น array ของทุกช่วงที่ได้รับมอบหมาย
        res.json({ success: true, data: rows[0] || null, list: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/layerlist', async (req, res) => {
    try {
        // Check if layerlist table exists, if not create it
        const checkTableSql = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'layerlist')`;
        const checkResult = await pool.query(checkTableSql);
        const tableExists = checkResult.rows[0].exists;

        if (!tableExists) {
            const createTableSql = `
                CREATE TABLE layerlist (
                    id SERIAL PRIMARY KEY,
                    tb_name TEXT NOT NULL UNIQUE,
                    remark TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `;
            await pool.query(createTableSql);
        }

        const sql = `SELECT * FROM layerlist`;
        const result = await pool.query(sql);
        // console.log(result.rows);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
})

app.post('/api/layerlist', async (req, res) => {
    try {
        const { tb_name, remark } = req.body;

        const sql = `
        INSERT INTO layerlist (tb_name, remark)
        VALUES ($1, $2)
        RETURNING *`;
        const result = await pool.query(sql, [tb_name, remark]);

        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

/* PUT /api/layerlist/:tb/displayname
   อัปเดต display name ใน layerlist โดยไม่เปลี่ยน table จริงใน PostgreSQL
   body: { display_name: "PLK" }  ← ชื่อที่ต้องการแสดง (case ตามที่พิมพ์)
*/
app.put('/api/layerlist/:tb/displayname', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const { display_name } = req.body;

        if (!tb || !display_name) {
            return res.status(400).json({ error: 'tb and display_name are required' });
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(display_name)) {
            return res.status(400).json({ error: 'display_name must start with a letter and contain only letters, numbers and underscores' });
        }
        if (display_name.toLowerCase() !== tb) {
            return res.status(400).json({ error: 'display_name must refer to the same table (same letters, different case only)' });
        }

        const result = await pool.query(
            `UPDATE layerlist SET tb_name = $1, updated_at = NOW() WHERE LOWER(tb_name) = $2 RETURNING *`,
            [display_name, tb]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: `Project "${tb}" not found` });
        }
        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/layerlist/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // drop view
        const sql0 = `DROP VIEW IF EXISTS v_reclass_${tb}`;
        await pool.query(sql0);

        const sql1 = `DELETE FROM layerlist WHERE LOWER(tb_name) = $1 RETURNING *`;
        const result = await pool.query(sql1, [tb]);

        // delete reclass table
        const sql2 = `DROP TABLE IF EXISTS reclass_${tb}`;
        await pool.query(sql2);

        // delete source table
        const sql3 = `DROP TABLE IF EXISTS ${tb}`;
        await pool.query(sql3);

        const sql4 = `DROP TABLE IF EXISTS backup_${tb}`;
        await pool.query(sql4);

        try {
            await pool.query('DELETE FROM task_assignments WHERE LOWER(tb_name) = $1', [tb]);
        } catch (e) {
            console.log('task_assignments table might not exist yet');
        }

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Table not found' });
        }

        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/area', async (req, res) => {
    const geojson = req.body;
    const geometry = geojson.geometry || geojson;

    if (!geometry || !geometry.type || !geometry.coordinates) {
        return res.status(400).json({ error: 'Missing or invalid GeoJSON geometry' });
    }

    try {
        // ✅ รองรับทั้ง Polygon และ MultiPolygon
        function getPolygonCentroid(coords, type) {
            let x = 0, y = 0, total = 0;

            if (type === 'Polygon') {
                for (const ring of coords) {
                    for (const [lon, lat] of ring) {
                        x += lon;
                        y += lat;
                        total++;
                    }
                }
            } else if (type === 'MultiPolygon') {
                for (const polygon of coords) {
                    for (const ring of polygon) {
                        for (const [lon, lat] of ring) {
                            x += lon;
                            y += lat;
                            total++;
                        }
                    }
                }
            }

            return total > 0 ? [x / total, y / total] : [null, null];
        }

        function getUTMEPSGCode(lon, lat) {
            const zone = Math.floor((lon + 180) / 6) + 1;
            const isNorthern = lat >= 0;
            return isNorthern ? 32600 + zone : 32700 + zone;
        }

        function getEPSGFromGeoJSON(geojson) {
            const coords = geojson.geometry.coordinates;
            const type = geojson.geometry.type;
            const [lon, lat] = getPolygonCentroid(coords, type);

            if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
                return 4326; // fallback
            }

            return getUTMEPSGCode(lon, lat);
        }

        const epsg = getEPSGFromGeoJSON(geojson);
        const geojsonStr = JSON.stringify(geometry);

        const sql = `
            SELECT ST_Area(
                ST_Transform(
                    ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                    ${epsg}
                )
            ) AS area;
        `;

        const { rows } = await pool.query(sql, [geojsonStr]);
        return res.json({ success: true, area: rows[0].area });


    } catch (err) {
        console.error('Error in /api/area:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Transient topology check (ไม่บันทึกลง DB) — ใช้โดยหน้า reshape ระหว่างวาด/ลากจุด
// เพื่อเตือนสดๆ ว่าแปลงที่กำลังแก้ไขซ้อนทับแปลงอื่นในตารางหลักหรือไม่ (ไม่รวม shpall)
app.post('/api/check_topology_live/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) return res.status(400).json({ error: 'Table name is required' });
        const { geometry, excludeId } = req.body;
        if (!geometry || !geometry.type || !geometry.coordinates) {
            return res.status(400).json({ error: 'Missing or invalid GeoJSON geometry' });
        }
        const utmSrid = getUtmSridFromGeoJSON(geometry); // 32647 หรือ 32648 ตามตำแหน่งจริงของแปลง

        const sql = `
            WITH input AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
            )
            SELECT
                b.id AS b_id,
                ROUND(ST_Area(ST_Transform(ST_Intersection(i.geom, b.geom), ${utmSrid}))::numeric, 2) AS overlap_sqm
            FROM input i
            JOIN ${tb} b
              ON b.id IS DISTINCT FROM $2::integer
             AND b.geom IS NOT NULL
             AND i.geom && b.geom
             AND ST_Intersects(i.geom, b.geom)
             AND NOT ST_Touches(i.geom, b.geom)
            ORDER BY overlap_sqm DESC NULLS LAST
        `;
        const result = await pool.query(sql, [JSON.stringify(geometry), excludeId || null]);

        const status = result.rows.length ? 'overlap' : 'ok';

        res.status(200).json({ success: true, status, overlaps: result.rows });
    } catch (err) {
        console.error('check_topology_live error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// /api/split removed — unused endpoint



app.post('/api/collected_feat', async (req, res) => {
    try {
        const { id_list, tb, displayName } = req.body;
        if (!Array.isArray(id_list) || id_list.length < 2) {
            return res.status(400).json({ success: false, error: 'ต้องมี polygon อย่างน้อย 2 อัน' });
        }

        const placeholders = id_list.map((_, i) => `$${i + 1}`).join(',');
        const sql = `
            WITH raw AS (
                SELECT geom
                FROM public.reclass_${tb}
                WHERE sub_id IN (${placeholders}) AND classtype='rubber'
            ),
            srid_pick AS (
                -- เลือกโซน UTM เดียวจาก centroid ของกลุ่มแปลงที่จะรวมทั้งหมด (ไม่ hardcode 32647)
                -- ต้องใช้โซนเดียวกันทุกแถวตอน transform ไม่งั้น ST_Union จะรวมพิกัดคนละระบบกัน
                SELECT ${UTM_SRID_SQL('ST_Collect(geom)')} AS srid FROM raw
            ),
            polys AS (
                SELECT ST_Transform(ST_MakeValid(r.geom), s.srid) AS geom_proj
                FROM raw r, srid_pick s
            )
            SELECT
                ST_AsGeoJSON(ST_Transform(ST_Union(geom_proj), 4326)) AS geom,
                SUM(ST_Area(geom_proj)) AS shpsplit_sqm
            FROM polys;
        `;

        const result = await pool.query(sql, id_list);
        if (!result.rows[0] || !result.rows[0].geom) {
            return res.status(400).json({ success: false, error: 'ไม่สามารถรวม polygon ได้' });
        }

        const geomJSON = JSON.parse(result.rows[0].geom);
        const area = Number(result.rows[0].shpsplit_sqm.toFixed(2));

        await pool.query(
            `UPDATE public.reclass_${tb}
             SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 shpsplit_sqm = $2,
                 "class_Area" = ROUND(($2::numeric / 1600.0), 2),
                 editor = $3
             WHERE sub_id = $4 AND classtype='rubber'`,
            [JSON.stringify(geomJSON), area, displayName, id_list[0]]
        );

        const idsToDelete = id_list.slice(1);
        if (idsToDelete.length > 0) {
            const delPlaceholders = idsToDelete.map((_, i) => `$${i + 1}`).join(',');
            await pool.query(
                `DELETE FROM public.reclass_${tb} WHERE sub_id IN (${delPlaceholders}) AND classtype='rubber'`,
                idsToDelete
            );
        }

        res.json({ success: true, geom: geomJSON, shpsplit_sqm: area });
    } catch (err) {
        console.error('Collected_feat error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Multer configuration for file upload
const upload = multer({ dest: 'uploads/' });

// Helper to normalize properties: lowercase keys and values, ensure all template columns exist
const normalizeProperties = (props) => {
    const numericCols = [
        'No_Plot', 'Rubr_Rai', 'Rubr_Ngan', 'Rubr_sqwa', 'Rubr_total',
        'Deed_Rai', 'Deed_Ngan', 'Deed_sqwa', 'Deed_total',
        'Para_Age', 'X', 'Y',
        'Rubr_Sqm', 'Deed_Sqm', 'Rubr_Area', 'Deed_Area', 'Sqm_Rub', 'Sqm_Deed'
    ];

    const normalized = {};
    const sourceLower = {};
    for (let key in props) {
        sourceLower[key.toLowerCase()] = props[key];
    }

    // Text fields
    normalized.Farmer_ID = sourceLower.farmer_id || sourceLower.id_farmer || '';
    normalized.Regis_No = sourceLower.regis_no || '';
    normalized.No_Plot = sourceLower.no_plot || 0;
    normalized.Title_name = sourceLower.title_name || sourceLower.titl_nam || '';
    normalized.F_name = sourceLower.f_name || '';
    normalized.L_name = sourceLower.l_name || '';
    normalized.Full_nam = sourceLower.full_nam || '';
    normalized.Address = sourceLower.address || '';
    normalized.Sub_Dis = sourceLower.sub_dis || '';
    normalized.District = sourceLower.district || '';
    normalized.Province = sourceLower.province || '';
    normalized.F_Status = sourceLower.f_status || sourceLower.status || '';
    normalized.Deed_ID = sourceLower.deed_id || sourceLower.title_no || '';
    normalized.Deed_Type = sourceLower.deed_type || sourceLower.title_type || '';

    // Area fields (rai/ngan/sqwa)
    normalized.Rubr_Rai = sourceLower.rubr_rai || sourceLower.yang_rai || 0;
    normalized.Rubr_Ngan = sourceLower.rubr_ngan || 0;
    normalized.Rubr_sqwa = sourceLower.rubr_sqwa || 0;
    normalized.Rubr_total = sourceLower.rubr_total || 0;
    normalized.Deed_Rai = sourceLower.deed_rai || sourceLower.rai || 0;
    normalized.Deed_Ngan = sourceLower.deed_ngan || 0;
    normalized.Deed_sqwa = sourceLower.deed_sqwa || 0;
    normalized.Deed_total = sourceLower.deed_total || 0;
    normalized.Para_Age = sourceLower.para_age || sourceLower.age || 0;
    normalized.X = sourceLower.x || 0;
    normalized.Y = sourceLower.y || 0;

    // New area fields (m² and rai with 2 decimal)
    // Deed_Sqm = เนื้อที่เป้าหมายโฉนด (m²)
    normalized.Deed_Sqm = sourceLower.deed_sqm || (normalized.Deed_total * 1600) || 0;
    // Rubr_Sqm = เนื้อที่เป้าหมายยางพารา (m²)
    normalized.Rubr_Sqm = sourceLower.rubr_sqm || (normalized.Rubr_total * 1600) || 0;
    // Sqm_Deed = เนื้อที่ขณะนี้โฉนด (m²)
    normalized.Sqm_Deed = sourceLower.sqm_deed || 0;
    // Deed_Area = เนื้อที่ขณะนี้โฉนด (ไร่) — ผูกกับ Sqm_Deed เสมอ ไม่ดึงจาก attribute เป้าหมายของไฟล์ดิบ
    normalized.Deed_Area = parseFloat((normalized.Sqm_Deed / 1600).toFixed(2));

    // System fields
    normalized.refinal = sourceLower.refinal || '';

    return normalized;
};

// อ่าน .prj (WKT) แล้วพยายามหา EPSG/UTM zone ที่แท้จริง แทนการเดา zone 47N คงที่
function detectSridFromPrjContent(prjContent) {
    if (!prjContent) return null;

    // 1) กรณี WKT มี AUTHORITY["EPSG","XXXXX"] ระบุตรง ๆ (เอาตัวสุดท้าย = PROJCS code)
    const authMatches = [...prjContent.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/gi)];
    if (authMatches.length > 0) {
        const code = parseInt(authMatches[authMatches.length - 1][1], 10);
        if (code) return code;
    }

    // 2) กรณีชื่อ projection ระบุ zone ตรง ๆ เช่น "UTM_Zone_48N" หรือ "UTM zone 48S"
    const nameMatch = prjContent.match(/UTM[_\s]*Zone[_\s]*(\d{1,2})\s*([NS])?/i);
    if (nameMatch) {
        const zone = parseInt(nameMatch[1], 10);
        const isSouth = (nameMatch[2] || '').toUpperCase() === 'S';
        if (zone >= 1 && zone <= 60) return isSouth ? 32700 + zone : 32600 + zone;
    }

    // 3) คำนวณ zone จาก central_meridian ในพารามิเตอร์ projection
    const cmMatch = prjContent.match(/central_meridian["\s,]+(-?\d+(?:\.\d+)?)/i);
    if (cmMatch) {
        const cm = parseFloat(cmMatch[1]);
        const zone = Math.round((cm + 183) / 6);
        const isSouth = /south/i.test(prjContent);
        if (zone >= 1 && zone <= 60) return isSouth ? 32700 + zone : 32600 + zone;
    }

    return null;
}

// Upload Shapefile endpoint
app.post('/api/upload-shapefile', upload.single('shpFile'), async (req, res) => {
    const { tb_name, geom_type, remark } = req.body;
    const zipFilePath = req.file?.path;

    if (!tb_name || !zipFilePath || !geom_type) {
        return res.status(400).json({ error: 'Table name, geometry type and shapefile are required' });
    }

    const extractDir = path.join('uploads', `extract_${Date.now()}`);

    try {
        await fs.promises.mkdir(extractDir, { recursive: true });
        await new Promise((resolve, reject) => {
            fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        const findFiles = (dir, ext) => {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    results = results.concat(findFiles(fullPath, ext));
                } else if (fullPath.toLowerCase().endsWith(ext)) {
                    results.push(fullPath);
                }
            });
            return results;
        };

        const shpFiles = findFiles(extractDir, '.shp');
        const dbfFiles = findFiles(extractDir, '.dbf');
        const cpgFiles = findFiles(extractDir, '.cpg');
        const prjFiles = findFiles(extractDir, '.prj');

        if (shpFiles.length === 0) throw new Error('No .shp file found in the ZIP');

        let encoding = 'tis-620'; // Default to Thai encoding
        if (cpgFiles.length > 0) {
            try {
                const cpgContent = fs.readFileSync(cpgFiles[0], 'utf8').trim().toLowerCase();
                if (cpgContent) encoding = cpgContent;
            } catch (e) {
                console.error('Error reading CPG:', e);
            }
        }

        const source = await shapefile.open(shpFiles[0], dbfFiles.length > 0 ? dbfFiles[0] : null, { encoding });
        const features = [];
        let result = await source.read();
        while (!result.done) {
            features.push(result.value);
            result = await source.read();
        }

        if (features.length === 0) throw new Error('No features found in shapefile');

        let useGeomPoint = geom_type === 'point';

        const createTableSql = `
            CREATE TABLE ${tb_name} (
                id             SERIAL PRIMARY KEY,
                "Farmer_ID"    text,
                "Regis_No"     text,
                "No_Plot"      numeric,
                "Title_name"   text,
                "F_name"       text,
                "L_name"       text,
                "Full_nam"     text,
                "Address"      text,
                "Sub_Dis"      text,
                "District"     text,
                "Province"     text,
                "F_Status"     text,
                "Deed_ID"      text,
                "Deed_Type"    text,
                "Rubr_Rai"     numeric,
                "Rubr_Ngan"    numeric,
                "Rubr_sqwa"    numeric,
                "Rubr_total"   numeric,
                "Deed_Rai"     numeric,
                "Deed_Ngan"    numeric,
                "Deed_sqwa"    numeric,
                "Deed_total"   numeric,
                "Para_Age"     numeric,
                "X"            numeric,
                "Y"            numeric,
                "Rubr_Sqm"     numeric,
                "Deed_Sqm"     numeric,
                "class_Area"    numeric(10,2),
                "Deed_Area"    numeric(10,2),
                "Sqm_Rub"      numeric,
                "Sqm_Deed"     numeric,
                geom           GEOMETRY(MultiPolygon, 4326),
                geom_point     GEOMETRY(Point, 4326),
                refinal        text,
                classified     boolean DEFAULT FALSE,
                editor         text,
                ts             timestamp DEFAULT NOW()
            );
            CREATE INDEX idx_${tb_name}_geom ON ${tb_name} USING GIST(geom);
            CREATE INDEX idx_${tb_name}_geom_point ON ${tb_name} USING GIST(geom_point);

            CREATE TABLE reclass_${tb_name} (
                fid SERIAL PRIMARY KEY, id INTEGER, sub_id TEXT, farmer_id TEXT, shpsplit_sqm NUMERIC, "class_Area" NUMERIC, geom GEOMETRY(MultiPolygon, 4326), geom_point GEOMETRY(Point, 4326), classtype TEXT, editor TEXT, ts TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX idx_reclass_${tb_name}_geom ON reclass_${tb_name} USING GIST(geom);

            CREATE VIEW v_reclass_${tb_name} AS SELECT
                a.id,
                a."Farmer_ID", a."Regis_No", a."No_Plot",
                a."Title_name", a."F_name", a."L_name", a."Full_nam", a."Address",
                a."Sub_Dis", a."District", a."Province", a."F_Status",
                a."Deed_ID", a."Deed_Type",
                a."Rubr_Rai", a."Rubr_Ngan", a."Rubr_sqwa", a."Rubr_total",
                a."Deed_Rai", a."Deed_Ngan", a."Deed_sqwa", a."Deed_total",
                a."Para_Age", a."X", a."Y",
                a."Rubr_Sqm", a."Deed_Sqm", a."Deed_Area",
                a."Sqm_Deed",
                a.refinal, a.classified,
                a.editor AS a_editor, a.ts AS a_ts,
                r.fid AS reclass_fid, r.sub_id AS reclass_sub_id,
                r.shpsplit_sqm AS r_shpsplit_sqm, r."class_Area", r.classtype,
                r.editor AS reclass_editor, r.ts AS r_ts, r.geom
            FROM ${tb_name} AS a
            JOIN reclass_${tb_name} AS r ON a.id = r.id;
        `;
        await pool.query(`DROP VIEW IF EXISTS v_reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS ${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS backup_${tb_name}`);
        try {
            await pool.query(`DELETE FROM task_assignments WHERE tb_name = $1`, [tb_name]);
        } catch (e) { }

        await pool.query(createTableSql);

        // Detect Source SRID (Automatic UTM vs WGS84 detection)
        let sourceSrid = 4326;
        let prjSrid = null;
        if (prjFiles.length > 0) {
            try {
                const prjContent = fs.readFileSync(prjFiles[0], 'utf8');
                prjSrid = detectSridFromPrjContent(prjContent);
            } catch (e) { }
        }
        if (features.length > 0 && features[0].geometry) {
            const getFirstCoord = (geom) => {
                if (geom.type === 'Point') return geom.coordinates;
                if (geom.type === 'Polygon') return geom.coordinates[0][0];
                if (geom.type === 'MultiPolygon') return geom.coordinates[0][0][0];
                return null;
            };
            const firstCoord = getFirstCoord(features[0].geometry);
            if (firstCoord && (Math.abs(firstCoord[0]) > 400 || Math.abs(firstCoord[1]) > 400)) {
                // ใช้ zone จากไฟล์ .prj ถ้าอ่านได้ ไม่เช่นนั้น fallback เป็น UTM Zone 47N (ค่าเดิม)
                sourceSrid = prjSrid || 32647;
                console.log(`Detected Projected Coordinates. Using source SRID: ${sourceSrid}${prjSrid ? ' (from .prj)' : ' (fallback assumption)'}`);
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (let f of features) {
                const norm = normalizeProperties(f.properties);
                const geomJson = JSON.stringify(f.geometry);
                let geomVal, geomPointVal;
                if (geom_type === 'point') {
                    geomPointVal = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326)`;
                    geomVal = `NULL`;
                } else {
                    geomVal = `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                    geomPointVal = `ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                }

                const insertSql = `
                    WITH main_ins AS (
                        INSERT INTO ${tb_name} (
                            "Farmer_ID", "Regis_No", "No_Plot", "Title_name", "F_name", "L_name", "Full_nam",
                            "Address", "Sub_Dis", "District", "Province", "F_Status", "Deed_ID", "Deed_Type",
                            "Rubr_Rai", "Rubr_Ngan", "Rubr_sqwa", "Rubr_total",
                            "Deed_Rai", "Deed_Ngan", "Deed_sqwa", "Deed_total",
                            "Para_Age", "X", "Y",
                            "Rubr_Sqm", "Deed_Sqm", "Deed_Area",
                            "Sqm_Deed",
                            refinal,
                            geom, geom_point
                        )
                        VALUES (
                            $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                            $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
                            $27,$28,$29,$30,
                            $31,
                            ${geomVal}, ${geomPointVal}
                        )
                        RETURNING id, "Farmer_ID" AS farmer_id, "Sqm_Deed" AS shpsplit_sqm, geom, geom_point
                    )
                    INSERT INTO reclass_${tb_name} (id, sub_id, farmer_id, shpsplit_sqm, "class_Area", geom, geom_point, classtype)
                    SELECT id, id::text, farmer_id, shpsplit_sqm, ROUND((shpsplit_sqm::numeric / 1600.0), 2), geom, geom_point, '${geom_type}' FROM main_ins;
                `;
                const params = [
                    geomJson,
                    norm.Farmer_ID, norm.Regis_No, norm.No_Plot, norm.Title_name, norm.F_name, norm.L_name, norm.Full_nam,
                    norm.Address, norm.Sub_Dis, norm.District, norm.Province, norm.F_Status, norm.Deed_ID, norm.Deed_Type,
                    norm.Rubr_Rai, norm.Rubr_Ngan, norm.Rubr_sqwa, norm.Rubr_total,
                    norm.Deed_Rai, norm.Deed_Ngan, norm.Deed_sqwa, norm.Deed_total,
                    norm.Para_Age, norm.X, norm.Y,
                    norm.Rubr_Sqm, norm.Deed_Sqm, norm.Deed_Area,
                    norm.Sqm_Deed,
                    norm.refinal
                ];
                await client.query(insertSql, params);
            }
            await client.query('COMMIT');

            await pool.query(`INSERT INTO layerlist (tb_name, remark) VALUES ($1, $2) ON CONFLICT (tb_name) DO UPDATE SET updated_at = NOW()`, [tb_name, remark || `${geom_type} layer`]);

            // ── AUTO BACKUP: copy main table → backup_{tb_name} ──────────────────
            try {
                await pool.query(`DROP TABLE IF EXISTS backup_${tb_name}`);
                await pool.query(`CREATE TABLE backup_${tb_name} AS SELECT * FROM ${tb_name}`);
                await pool.query(`ALTER TABLE backup_${tb_name} ADD COLUMN backup_at TIMESTAMPTZ DEFAULT NOW()`);
                await pool.query(`UPDATE backup_${tb_name} SET backup_at = NOW()`);
                console.log(`[BACKUP] Created backup_${tb_name} with ${features.length} rows`);
            } catch (backupErr) {
                console.error('[BACKUP] Warning: backup table creation failed:', backupErr.message);
                // ไม่ throw error เพื่อไม่ให้กระทบ response หลัก
            }
            // ─────────────────────────────────────────────────────────────────────

            res.json({ success: true, message: 'Shapefile uploaded successfully', recordCount: features.length, tableName: tb_name });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

app.get('/api/export-sql', async (req, res) => {
    try {
        const { exec } = require('child_process');
        const fileName = `${process.env.DB_NAME || 'rub2'}.sql`;
        const filePath = path.join(__dirname, '..', 'uploads', fileName);
        if (!fs.existsSync(path.join(__dirname, '..', 'uploads'))) fs.mkdirSync(path.join(__dirname, '..', 'uploads'));
        process.env.PGPASSWORD = process.env.DB_PASSWORD;
        const command = `pg_dump -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -f "${filePath}"`;
        exec(command, (error) => {
            if (error) return res.status(500).json({ error: 'Failed' });
            res.download(filePath, fileName);
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ────────────────────────────────────────────────────────────
   NEW: Create Project – build empty table from template
   POST /api/create-project
   body: { tb_name: "champhon_earn", remark: "..." }
──────────────────────────────────────────────────────────── */
app.post('/api/create-project', async (req, res) => {
    const { tb_name, remark } = req.body;

    if (!tb_name) {
        return res.status(400).json({ error: 'tb_name is required' });
    }

    // Validate table name (letters, numbers, underscore — case insensitive input)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tb_name)) {
        return res.status(400).json({ error: 'Table name must start with a letter and contain only letters, numbers and underscores' });
    }

    // Use lowercase only for PostgreSQL table/index/view identifiers (PG folds unquoted identifiers)
    // Original tb_name is preserved for display in layerlist
    const safe_name = tb_name.toLowerCase();

    try {
        // Check for duplicate project name (case-insensitive)
        const dupCheck = await pool.query('SELECT tb_name FROM layerlist WHERE LOWER(tb_name) = $1', [safe_name]);
        if (dupCheck.rows.length > 0) {
            return res.status(409).json({ error: `ชื่อ Project "${dupCheck.rows[0].tb_name}" มีอยู่แล้ว กรุณาใช้ชื่ออื่น` });
        }

        // Drop existing objects first (idempotent re-create)
        await pool.query(`DROP VIEW IF EXISTS v_reclass_${safe_name}`);
        await pool.query(`DROP TABLE IF EXISTS reclass_${safe_name}`);
        await pool.query(`DROP TABLE IF EXISTS ${safe_name}`);
        await pool.query(`DROP TABLE IF EXISTS backup_${safe_name}`);
        try {
            await pool.query(`DELETE FROM task_assignments WHERE LOWER(tb_name) = $1`, [safe_name]);
        } catch (e) { }

        // Create main rubber table with full template schema
        const createMainTable = `
            CREATE TABLE ${safe_name} (
                id             SERIAL PRIMARY KEY,
                "Farmer_ID"    text,
                "Regis_No"     text,
                "No_Plot"      numeric,
                "Title_name"   text,
                "F_name"       text,
                "L_name"       text,
                "Full_nam"     text,
                "Address"      text,
                "Sub_Dis"      text,
                "District"     text,
                "Province"     text,
                "F_Status"     text,
                "Deed_ID"      text,
                "Deed_Type"    text,
                "Rubr_Rai"     numeric,
                "Rubr_Ngan"    numeric,
                "Rubr_sqwa"    numeric,
                "Rubr_total"   numeric,
                "Deed_Rai"     numeric,
                "Deed_Ngan"    numeric,
                "Deed_sqwa"    numeric,
                "Deed_total"   numeric,
                "Para_Age"     numeric,
                "X"            numeric,
                "Y"            numeric,
                "Rubr_Sqm"     numeric,
                "Deed_Sqm"     numeric,
                "Deed_Area"    numeric(10,2),
                "Sqm_Deed"     numeric,
                geom           GEOMETRY(MultiPolygon, 4326),
                geom_point     GEOMETRY(Point, 4326),
                refinal        text,
                classified     boolean DEFAULT FALSE,
                editor         text,
                ts             timestamp DEFAULT NOW()
            );
            CREATE INDEX idx_${safe_name}_geom       ON ${safe_name} USING GIST(geom);
            CREATE INDEX idx_${safe_name}_geom_point ON ${safe_name} USING GIST(geom_point);
        `;
        await pool.query(createMainTable);

        // Create companion reclass table
        const createReclassTable = `
            CREATE TABLE reclass_${safe_name} (
                fid          SERIAL PRIMARY KEY,
                id           INTEGER,
                sub_id       TEXT,
                farmer_id    TEXT,
                shpsplit_sqm NUMERIC,
                "class_Area" NUMERIC,
                geom         GEOMETRY(MultiPolygon, 4326),
                geom_point   GEOMETRY(Point, 4326),
                classtype    TEXT,
                editor       TEXT,
                ts           TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX idx_reclass_${safe_name}_geom ON reclass_${safe_name} USING GIST(geom);
        `;
        await pool.query(createReclassTable);

        // Create view
        const createView = `
            CREATE VIEW v_reclass_${safe_name} AS
            SELECT
                a.id,
                a."Farmer_ID", a."Regis_No", a."No_Plot",
                a."Title_name", a."F_name", a."L_name", a."Full_nam", a."Address",
                a."Sub_Dis", a."District", a."Province", a."F_Status",
                a."Deed_ID", a."Deed_Type",
                a."Rubr_Rai", a."Rubr_Ngan", a."Rubr_sqwa", a."Rubr_total",
                a."Deed_Rai", a."Deed_Ngan", a."Deed_sqwa", a."Deed_total",
                a."Para_Age", a."X", a."Y",
                a."Rubr_Sqm", a."Deed_Sqm", a."Deed_Area",
                a."Sqm_Deed",
                a.refinal, a.classified,
                a.editor AS a_editor, a.ts AS a_ts,
                r.fid AS reclass_fid, r.sub_id AS reclass_sub_id,
                r.shpsplit_sqm AS r_shpsplit_sqm, r."class_Area", r.classtype,
                r.editor AS reclass_editor, r.ts AS r_ts, r.geom
            FROM ${safe_name} AS a
            JOIN reclass_${safe_name} AS r ON a.id = r.id;
        `;
        await pool.query(createView);

        // Register in layerlist with original case (idempotent – skip if already exists)
        await pool.query(
            `INSERT INTO layerlist (tb_name, remark)
             VALUES ($1, $2)
             ON CONFLICT (tb_name) DO UPDATE SET remark = EXCLUDED.remark, updated_at = NOW()`,
            [tb_name, remark || '']
        );

        res.json({ success: true, tb_name });
    } catch (err) {
        console.error('create-project error:', err);
        res.status(500).json({ error: err.message });
    }
});

/* ────────────────────────────────────────────────────────────
   NEW: Upload shapefile to an EXISTING table
   POST /api/upload-shapefile-to-table
   multipart: shpFile (ZIP), tb_name, geom_type (polygon|point)

   • polygon → stored in  geom        column (MultiPolygon 4326)
   • point   → stored in  geom_point  column (Point 4326)
──────────────────────────────────────────────────────────── */
app.post('/api/upload-shapefile-to-table', upload.single('shpFile'), async (req, res) => {
    const { tb_name, geom_type } = req.body;
    const zipFilePath = req.file?.path;

    if (!tb_name || !zipFilePath || !geom_type) {
        return res.status(400).json({ error: 'tb_name, geom_type and shapefile are required' });
    }
    if (!['polygon', 'point'].includes(geom_type)) {
        return res.status(400).json({ error: 'geom_type must be polygon or point' });
    }

    // PostgreSQL table names are always lowercase (PG folds unquoted identifiers)
    const safe_name = tb_name.toLowerCase();

    const extractDir = path.join('uploads', `extract_${Date.now()}`);

    try {
        // Check table exists (use lowercase for PostgreSQL catalog lookup)
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [safe_name]
        );
        if (!tableCheck.rows[0].exists) {
            return res.status(404).json({ error: `Table "${tb_name}" not found. Please create the project first.` });
        }

        // Ensure reclass table has class_Area before uploading
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE reclass_${safe_name} ADD COLUMN "class_Area" numeric;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
                WHEN undefined_table THEN NULL;
            END $$;
        `);

        await fs.promises.mkdir(extractDir, { recursive: true });
        await new Promise((resolve, reject) => {
            fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        const findFiles = (dir, ext) => {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    results = results.concat(findFiles(fullPath, ext));
                } else if (fullPath.toLowerCase().endsWith(ext)) {
                    results.push(fullPath);
                }
            });
            return results;
        };

        const shpFiles = findFiles(extractDir, '.shp');
        const dbfFiles = findFiles(extractDir, '.dbf');
        const cpgFiles = findFiles(extractDir, '.cpg');
        const prjFiles = findFiles(extractDir, '.prj');

        if (shpFiles.length === 0) throw new Error('No .shp file found in the ZIP');

        let encoding = 'tis-620';
        if (cpgFiles.length > 0) {
            try {
                const cpgContent = fs.readFileSync(cpgFiles[0], 'utf8').trim().toLowerCase();
                if (cpgContent) encoding = cpgContent;
            } catch (e) { }
        }

        const source = await shapefile.open(shpFiles[0], dbfFiles.length > 0 ? dbfFiles[0] : null, { encoding });
        const features = [];
        let result = await source.read();
        while (!result.done) {
            features.push(result.value);
            result = await source.read();
        }
        if (features.length === 0) throw new Error('No features found in shapefile');

        // Detect source SRID
        let sourceSrid = 4326;
        let prjSrid = null;
        if (prjFiles.length > 0) {
            try {
                const prjContent = fs.readFileSync(prjFiles[0], 'utf8');
                prjSrid = detectSridFromPrjContent(prjContent);
            } catch (e) { }
        }
        if (features.length > 0 && features[0].geometry) {
            const getFirstCoord = (geom) => {
                if (geom.type === 'Point') return geom.coordinates;
                if (geom.type === 'Polygon') return geom.coordinates[0][0];
                if (geom.type === 'MultiPolygon') return geom.coordinates[0][0][0];
                return null;
            };
            const firstCoord = getFirstCoord(features[0].geometry);
            if (firstCoord && (Math.abs(firstCoord[0]) > 400 || Math.abs(firstCoord[1]) > 400)) {
                sourceSrid = prjSrid || 32647;
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (let f of features) {
                const norm = normalizeProperties(f.properties);
                const geomJson = JSON.stringify(f.geometry);

                let geomVal, geomPointVal;
                if (geom_type === 'point') {
                    geomPointVal = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326)`;
                    geomVal = `NULL`;
                } else {
                    geomVal = `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                    geomPointVal = `ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                }

                const insertSql = `
                    WITH main_ins AS (
                        INSERT INTO ${safe_name} (
                            "Farmer_ID", "Regis_No", "No_Plot", "Title_name", "F_name", "L_name", "Full_nam",
                            "Address", "Sub_Dis", "District", "Province", "F_Status", "Deed_ID", "Deed_Type",
                            "Rubr_Rai", "Rubr_Ngan", "Rubr_sqwa", "Rubr_total",
                            "Deed_Rai", "Deed_Ngan", "Deed_sqwa", "Deed_total",
                            "Para_Age", "X", "Y",
                            "Rubr_Sqm", "Deed_Sqm", "Deed_Area",
                            "Sqm_Deed",
                            refinal,
                            geom, geom_point
                        )
                        VALUES (
                            $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                            $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
                            $27,$28,$29,$30,
                            $31,
                            ${geomVal}, ${geomPointVal}
                        )
                        RETURNING id, "Farmer_ID" AS farmer_id, "Sqm_Deed" AS shpsplit_sqm, geom, geom_point
                    )
                    INSERT INTO reclass_${safe_name} (id, sub_id, farmer_id, shpsplit_sqm, "class_Area", geom, geom_point, classtype)
                    SELECT id, id::text, farmer_id, shpsplit_sqm, ROUND((shpsplit_sqm::numeric / 1600.0), 2), geom, geom_point, '${geom_type}' FROM main_ins;
                `;
                const params = [
                    geomJson,
                    norm.Farmer_ID, norm.Regis_No, norm.No_Plot, norm.Title_name, norm.F_name, norm.L_name, norm.Full_nam,
                    norm.Address, norm.Sub_Dis, norm.District, norm.Province, norm.F_Status, norm.Deed_ID, norm.Deed_Type,
                    norm.Rubr_Rai, norm.Rubr_Ngan, norm.Rubr_sqwa, norm.Rubr_total,
                    norm.Deed_Rai, norm.Deed_Ngan, norm.Deed_sqwa, norm.Deed_total,
                    norm.Para_Age, norm.X, norm.Y,
                    norm.Rubr_Sqm, norm.Deed_Sqm, norm.Deed_Area,
                    norm.Sqm_Deed,
                    norm.refinal
                ];
                await client.query(insertSql, params);
            }

            await client.query('COMMIT');

            // ── AUTO BACKUP: upsert new rows into backup_{safe_name} ────────────
            try {
                // ตรวจสอบว่า backup table มีแล้วหรือยัง
                const bkCheck = await pool.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`backup_${safe_name}`]
                );
                if (!bkCheck.rows[0].exists) {
                    // สร้าง backup table ใหม่จาก structure ของ main table + คอลัมน์ backup_at
                    await pool.query(`CREATE TABLE backup_${safe_name} AS SELECT * FROM ${safe_name} WHERE FALSE`);
                    await pool.query(`ALTER TABLE backup_${safe_name} ADD COLUMN backup_at TIMESTAMPTZ DEFAULT NOW()`);
                }

                // เพิ่มข้อมูลที่ upload ใหม่ล่าสุดเข้า backup (rows ที่ไม่มีใน backup)
                const backupInsertResult = await pool.query(`
                    INSERT INTO backup_${safe_name}
                    SELECT m.*, NOW() AS backup_at
                    FROM ${safe_name} m
                    WHERE NOT EXISTS (
                        SELECT 1 FROM backup_${safe_name} b WHERE b.id = m.id
                    )
                `);
                console.log(`[BACKUP] Appended ${backupInsertResult.rowCount} new rows to backup_${safe_name}`);
            } catch (backupErr) {
                console.error('[BACKUP] Warning: backup append failed:', backupErr.message);
                // ไม่ throw error เพื่อไม่ให้กระทบ response หลัก
            }
            // ─────────────────────────────────────────────────────────────────────

            res.json({
                success: true,
                message: 'Shapefile uploaded successfully',
                recordCount: features.length,
                tableName: tb_name,
                geomType: geom_type
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('upload-shapefile-to-table error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

// ════════════════════════════════════════════════════════════
// BACKUP API ENDPOINTS
// ════════════════════════════════════════════════════════════

/**
 * GET /api/backup/:tb
 * ดูข้อมูลทั้งหมดใน backup table ของ tb
 */
app.get('/api/backup/:tb', async (req, res) => {
    let { tb } = req.params;
    tb = tb.toLowerCase();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    try {
        const checkResult = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );
        if (!checkResult.rows[0].exists) {
            return res.status(404).json({ success: false, error: `Backup table backup_${tb} not found` });
        }
        const result = await pool.query(`SELECT * FROM backup_${tb} ORDER BY id`);
        res.json({ success: true, count: result.rowCount, data: result.rows });
    } catch (err) {
        console.error('[BACKUP] GET error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/restore-from-backup/:tb/:id
 * restore แถวที่มี id=$id จาก backup_tb กลับไปยัง tb
 *
 * กรณีที่ 1 – id หายไปจาก tb (ถูกลบ):
 *   → INSERT แถวกลับเข้า main table ด้วยค่าต้นฉบับจาก backup ทั้งหมด
 *   → INSERT เข้า reclass_tb ด้วย shpsplit_sqm = shparea_sq (ค่าต้นฉบับ)
 *
 * กรณีที่ 2 – id ยังมีอยู่ใน tb แต่ต้องการ reset ค่าเนื้อที่กลับเป็นต้นฉบับ:
 *   → UPDATE shparea_sq, geom, geom_point ใน main table จาก backup
 *   → UPDATE shpsplit_sqm ใน reclass_tb ด้วยค่าต้นฉบับจาก backup
 *
 * Query param: ?mode=reset  → บังคับ reset ค่าแม้ id ยังอยู่
 */
app.post('/api/restore-from-backup/:tb/:id', async (req, res) => {
    let { tb, id } = req.params;
    tb = tb.toLowerCase();
    const mode = req.query.mode || 'auto'; // 'auto' | 'reset'

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    const featureId = parseInt(id, 10);
    if (isNaN(featureId)) {
        return res.status(400).json({ error: 'ID must be a number' });
    }
    try {
        // ── ตรวจสอบว่า backup table มีอยู่ ──────────────────────────────────────
        const backupCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );
        if (!backupCheck.rows[0].exists) {
            return res.status(404).json({ success: false, error: `Backup table backup_${tb} not found` });
        }

        // ── ดึงแถวต้นฉบับจาก backup ────────────────────────────────────────────
        const backupRow = await pool.query(
            `SELECT *, ST_AsGeoJSON(geom) AS geom_json FROM backup_${tb} WHERE id = $1 LIMIT 1`,
            [featureId]
        );
        if (backupRow.rowCount === 0) {
            return res.status(404).json({ success: false, error: `ID ${featureId} not found in backup_${tb}` });
        }
        const bk = backupRow.rows[0];
        const originalShparea = bk['Sqm_Deed']; // ค่าเนื้อที่ขณะนี้โฉนด (ต้นฉบับ)

        // ── ตรวจสอบว่า id ยังมีอยู่ใน main table หรือไม่ ──────────────────────
        const mainRow = await pool.query(`SELECT id FROM ${tb} WHERE id = $1`, [featureId]);
        const idExists = mainRow.rowCount > 0;

        let restoredRow = null;
        let actionTaken = '';

        if (!idExists) {
            // ════ กรณีที่ 1: id หายไป → INSERT กลับด้วยค่าต้นฉบับทั้งหมด ═══════

            // ดึงคอลัมน์ใน main table (ไม่รวม backup_at)
            const colsResult = await pool.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=$1
                 ORDER BY ordinal_position`,
                [tb]
            );
            const mainCols = colsResult.rows.map(r => r.column_name);
            const colList = mainCols.join(', ');

            const restoreResult = await pool.query(`
                INSERT INTO ${tb} (${colList})
                SELECT ${colList}
                FROM backup_${tb}
                WHERE id = $1
                ON CONFLICT (id) DO NOTHING
                RETURNING *
            `, [featureId]);

            if (restoreResult.rowCount === 0) {
                return res.status(409).json({ success: false, error: `ID ${featureId} conflict during insert, restore skipped.` });
            }
            restoredRow = restoreResult.rows[0];
            actionTaken = 'inserted';

        } else if (mode === 'reset') {
            // ════ กรณีที่ 2: id มีอยู่ + mode=reset → UPDATE ค่ากลับเป็นต้นฉบับ ═

            const updateResult = await pool.query(`
                UPDATE ${tb}
                SET "Sqm_Deed"  = b."Sqm_Deed",
                    "Deed_Area" = ROUND((b."Sqm_Deed" / 1600.0)::numeric, 2),
                    geom        = b.geom,
                    geom_point  = b.geom_point
                FROM backup_${tb} b
                WHERE ${tb}.id = $1
                  AND b.id     = $1
                RETURNING ${tb}.*
            `, [featureId]);

            restoredRow = updateResult.rows[0];
            actionTaken = 'reset';

        } else {
            // id มีอยู่ ไม่ได้ส่ง mode=reset
            return res.status(409).json({
                success: false,
                error: `ID ${featureId} already exists in ${tb}. ส่ง ?mode=reset เพื่อ reset ค่าเนื้อที่กลับเป็นต้นฉบับ`,
                hint: `POST /api/restore-from-backup/${tb}/${featureId}?mode=reset`
            });
        }

        // ── Sync reclass_tb: อัปเดต shpsplit_sqm ด้วยค่าต้นฉบับจาก backup ─────
        const reclassCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        let reclassRestored = 0;
        if (reclassCheck.rows[0].exists) {
            const reclassExists = await pool.query(
                `SELECT id FROM reclass_${tb} WHERE id = $1 LIMIT 1`,
                [featureId]
            );

            if (reclassExists.rowCount === 0) {
                // ไม่มีใน reclass → INSERT row ใหม่ด้วยค่าต้นฉบับ
                await pool.query(`
                    INSERT INTO reclass_${tb} (id, sub_id, farmer_id, shpsplit_sqm, "class_Area", geom, classtype)
                    VALUES ($1, $2::text, $3, $4, $5, 'polygon')
                    ON CONFLICT DO NOTHING
                `, [
                    featureId,
                    featureId.toString(),
                    restoredRow['Farmer_ID'],
                    originalShparea,           // ← ค่าเนื้อที่ต้นฉบับจาก backup
                    restoredRow.geom
                ]);
                reclassRestored = 1;
            } else {
                // มีอยู่ใน reclass → UPDATE shpsplit_sqm กลับเป็นค่าต้นฉบับ
                await pool.query(`
                    UPDATE reclass_${tb}
                    SET shpsplit_sqm = $1, "class_Area" = ROUND(($1::numeric / 1600.0), 2),
                        geom        = $2
                    WHERE id = $3
                      AND (sub_id = $4 OR sub_id = $3::text)
                `, [
                    originalShparea,           // ← ค่าเนื้อที่ต้นฉบับจาก backup
                    restoredRow.geom,
                    featureId,
                    featureId.toString()
                ]);
                reclassRestored = 1;
            }
        }

        res.json({
            success: true,
            action: actionTaken,
            message: `ID ${featureId} ${actionTaken} from backup_${tb} (shparea_sq = ${originalShparea})`,
            originalShparea,
            restored: restoredRow,
            reclassRestored
        });
    } catch (err) {
        console.error('[BACKUP] restore error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});


/**
 * GET /api/backup-diff/:tb
 * เปรียบเทียบ ids ที่อยู่ใน backup แต่หายไปจาก main table
 * ช่วยให้รู้ว่า id ไหนบ้างที่หาย
 */
app.get('/api/backup-diff/:tb', async (req, res) => {
    let { tb } = req.params;
    tb = tb.toLowerCase();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    try {
        const backupCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );
        if (!backupCheck.rows[0].exists) {
            return res.status(404).json({ success: false, error: `Backup table backup_${tb} not found` });
        }

        // หา id ที่อยู่ใน backup แต่ไม่มีใน main table
        const diffResult = await pool.query(`
            SELECT b.id, b."Farmer_ID", b."F_name", b."L_name", b.backup_at
            FROM backup_${tb} b
            WHERE NOT EXISTS (
                SELECT 1 FROM ${tb} m WHERE m.id = b.id
            )
            ORDER BY b.id
        `);

        res.json({
            success: true,
            missingCount: diffResult.rowCount,
            missingIds: diffResult.rows
        });
    } catch (err) {
        console.error('[BACKUP] diff error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ══════════════════════════════════════════════════════════════
   PLOT LOCK APIs
   ให้แอดมินปิด (ล็อก) แปลงเป็นรายแปลง (tb_name + feature id) กัน worker แก้ไข
   เก็บแยกตารางเพราะ public.{tb} ถูก DROP/CREATE ใหม่ทุกครั้งที่ upload
══════════════════════════════════════════════════════════════ */

async function ensurePlotLocksTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS plot_locks (
            id             SERIAL PRIMARY KEY,
            tb_name        TEXT NOT NULL,
            feature_id     INTEGER NOT NULL,
            locked_by      INTEGER REFERENCES users(id),
            locked_by_name TEXT,
            locked_at      TIMESTAMP DEFAULT NOW(),
            UNIQUE (tb_name, feature_id)
        )
    `);
}

async function isPlotLocked(tb, featureId) {
    await ensurePlotLocksTable();
    const { rowCount } = await pool.query(
        `SELECT 1 FROM plot_locks WHERE LOWER(tb_name) = LOWER($1) AND feature_id = $2`,
        [tb, featureId]
    );
    return rowCount > 0;
}

/* คืน true (และตอบ 403 ให้เอง) ถ้าแปลงนี้ถูกล็อกและผู้เรียกไม่ใช่ admin — ใช้กันในทุก endpoint ที่แก้ไขข้อมูลแปลง */
async function blockIfLocked(req, res, tb, featureId) {
    const role = req.session?.user?.role;
    if (role === 'admin') return false;
    if (await isPlotLocked(tb, featureId)) {
        res.status(403).json({ success: false, error: 'แปลงนี้ถูกปิดโดยแอดมิน ไม่สามารถแก้ไขได้' });
        return true;
    }
    return false;
}

/* GET /api/plotlocks/:tb – รายการ feature id ที่ถูกล็อกทั้งหมดของ table นั้น */
app.get('/api/plotlocks/:tb', async (req, res) => {
    try {
        await ensurePlotLocksTable();
        const tb = req.params.tb.toLowerCase();
        const result = await pool.query(
            `SELECT feature_id, locked_by_name, locked_at FROM plot_locks WHERE LOWER(tb_name) = $1 ORDER BY feature_id`,
            [tb]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Error in GET /api/plotlocks:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* PUT /api/plotlocks/:tb/:id – แอดมินปิด (ล็อก) แปลง */
app.put('/api/plotlocks/:tb/:id', async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        if (!sessionUser) return res.status(401).json({ success: false, error: 'Not authenticated' });
        if (sessionUser.role !== 'admin') return res.status(403).json({ success: false, error: 'เฉพาะแอดมินเท่านั้นที่ปิดแปลงได้' });

        await ensurePlotLocksTable();
        const tb = req.params.tb.toLowerCase();
        const featureId = parseInt(req.params.id, 10);
        if (isNaN(featureId)) return res.status(400).json({ success: false, error: 'Feature ID must be a number' });

        await pool.query(
            `INSERT INTO plot_locks (tb_name, feature_id, locked_by, locked_by_name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tb_name, feature_id) DO UPDATE
             SET locked_by = $3, locked_by_name = $4, locked_at = NOW()`,
            [tb, featureId, sessionUser.id, sessionUser.displayName || null]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error in PUT /api/plotlocks:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* DELETE /api/plotlocks/:tb/:id – แอดมินปลดล็อกแปลง */
app.delete('/api/plotlocks/:tb/:id', async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        if (!sessionUser) return res.status(401).json({ success: false, error: 'Not authenticated' });
        if (sessionUser.role !== 'admin') return res.status(403).json({ success: false, error: 'เฉพาะแอดมินเท่านั้นที่ปลดล็อกแปลงได้' });

        await ensurePlotLocksTable();
        const tb = req.params.tb.toLowerCase();
        const featureId = parseInt(req.params.id, 10);
        if (isNaN(featureId)) return res.status(400).json({ success: false, error: 'Feature ID must be a number' });

        await pool.query(
            `DELETE FROM plot_locks WHERE LOWER(tb_name) = $1 AND feature_id = $2`,
            [tb, featureId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error in DELETE /api/plotlocks:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ══════════════════════════════════════════════════════════════
   TASK ASSIGNMENT APIs
   เก็บ assignment ของแต่ละคนต่อ table (tb_name, assignee, id_from, id_to)
══════════════════════════════════════════════════════════════ */

async function ensureTaskAssignmentsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_assignments (
            id        SERIAL PRIMARY KEY,
            tb_name   TEXT NOT NULL,
            assignee_name  TEXT NOT NULL,
            assignee_photo TEXT,
            id_from   INTEGER NOT NULL,
            id_to     INTEGER NOT NULL,
            note      TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
}

/* คำนวณสถานะกำหนดส่งของ 1 assignment จาก due_date + pct ความคืบหน้า
   ไม่นับ "เกินกำหนด/ใกล้ครบกำหนด" ถ้าทำเสร็จแล้ว (pct=100) หรือไม่ได้ตั้งกำหนดส่งไว้ (due_date เป็น null) */
function computeDueStatus(due_date, pct) {
    if (pct >= 100) return { status: 'done', days_left: null };
    if (!due_date) return { status: 'none', days_left: null };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(due_date);
    due.setHours(0, 0, 0, 0);
    const days_left = Math.round((due - today) / 86400000);
    if (days_left < 0) return { status: 'overdue', days_left };
    if (days_left <= 3) return { status: 'due_soon', days_left };
    return { status: 'on_track', days_left };
}

/* GET /api/task-assignments/:tb  – ดึง assignments ของ table นั้น */
app.get('/api/task-assignments/:tb', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const tb = req.params.tb.toLowerCase();
        const result = await pool.query(
            `SELECT * FROM task_assignments WHERE LOWER(tb_name) = $1 ORDER BY id_from`,
            [tb]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/task-assignments-all  – ดึง assignments ทั้งหมด */
app.get('/api/task-assignments-all', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const result = await pool.query(
            `SELECT * FROM task_assignments ORDER BY tb_name, id_from`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* POST /api/task-assignments  – สร้าง assignment ใหม่ */
app.post('/api/task-assignments', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const { tb_name, assignee_name, assignee_email, assignee_photo, user_id, id_from, id_to, note, due_date } = req.body;
        if (!tb_name || !assignee_name || id_from == null || id_to == null) {
            return res.status(400).json({ error: 'tb_name, assignee_name, id_from, id_to are required' });
        }
        if (parseInt(id_from) > parseInt(id_to)) {
            return res.status(400).json({ error: 'id_from must be <= id_to' });
        }
        const result = await pool.query(
            `INSERT INTO task_assignments (tb_name, assignee_name, assignee_email, assignee_photo, user_id, id_from, id_to, note, due_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [tb_name, assignee_name, assignee_email || null, assignee_photo || null,
             user_id ? parseInt(user_id) : null, parseInt(id_from), parseInt(id_to), note || null, due_date || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* PUT /api/task-assignments/:id  – อัปเดต assignment */
app.put('/api/task-assignments/:id', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const { id } = req.params;
        const { assignee_name, assignee_email, assignee_photo, user_id, id_from, id_to, note, due_date } = req.body;
        if (!assignee_name || id_from == null || id_to == null) {
            return res.status(400).json({ error: 'assignee_name, id_from, id_to are required' });
        }
        if (parseInt(id_from) > parseInt(id_to)) {
            return res.status(400).json({ error: 'id_from must be <= id_to' });
        }
        const result = await pool.query(
            `UPDATE task_assignments
             SET assignee_name=$1, assignee_email=$2, assignee_photo=$3, user_id=$4,
                 id_from=$5, id_to=$6, note=$7, due_date=$8, updated_at=NOW()
             WHERE id=$9
             RETURNING *`,
            [assignee_name, assignee_email || null, assignee_photo || null,
             user_id ? parseInt(user_id) : null,
             parseInt(id_from), parseInt(id_to), note || null, due_date || null, parseInt(id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* DELETE /api/task-assignments/:id  – ลบ assignment */
app.delete('/api/task-assignments/:id', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM task_assignments WHERE id=$1 RETURNING id`,
            [parseInt(id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
        res.json({ success: true, deleted: parseInt(id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/task-progress/:tb
   คำนวณ progress ของแต่ละ assignment โดยนับ ID ที่ classified=true ในช่วง id_from..id_to
   พร้อม editor คนล่าสุดใน reclass_<tb> และ ts ล่าสุด */
app.get('/api/task-progress/:tb', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        // ดึง assignments ของ table นี้
        const assignRes = await pool.query(
            `SELECT id, assignee_name, assignee_photo, id_from, id_to, note, due_date
             FROM task_assignments WHERE LOWER(tb_name) = $1 ORDER BY id_from`,
            [tb]
        );
        if (assignRes.rowCount === 0) {
            return res.json({ success: true, data: [] });
        }

        // ตรวจว่า main table มี classified column
        const colCheck = await pool.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name=$1 AND column_name='classified'`, [tb]
        );
        const hasClassified = colCheck.rowCount > 0;

        // ตรวจว่า reclass table มีอยู่
        const reclassCheck = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        const hasReclass = reclassCheck.rows[0].exists;

        // สร้าง progress สำหรับแต่ละ assignment
        const progressData = await Promise.all(assignRes.rows.map(async (a) => {
            const total = a.id_to - a.id_from + 1;

            // นับ classified
            let done = 0;
            if (hasClassified) {
                const doneRes = await pool.query(
                    `SELECT COUNT(*) AS cnt FROM ${tb}
                     WHERE id >= $1 AND id <= $2 AND classified = TRUE`,
                    [a.id_from, a.id_to]
                );
                done = parseInt(doneRes.rows[0].cnt) || 0;
            }

            // หา editor + ts ล่าสุดจาก reclass table
            let last_editor = null;
            let last_ts = null;
            if (hasReclass) {
                const editorRes = await pool.query(
                    `SELECT editor, ts FROM reclass_${tb}
                     WHERE id >= $1 AND id <= $2
                       AND editor IS NOT NULL
                     ORDER BY ts DESC LIMIT 1`,
                    [a.id_from, a.id_to]
                );
                if (editorRes.rowCount > 0) {
                    last_editor = editorRes.rows[0].editor;
                    last_ts = editorRes.rows[0].ts;
                }
            }

            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const { status: due_status, days_left } = computeDueStatus(a.due_date, pct);

            return {
                ...a,
                total,
                done,
                pct,
                last_editor,
                last_ts,
                due_status,
                days_left
            };
        }));

        res.json({ success: true, data: progressData });
    } catch (err) {
        console.error('[TASK-PROGRESS]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/my-due-notifications
   แจ้งเตือนกำหนดส่งงานของผู้ login อยู่ (ทุกโปรเจคที่ตัวเองได้รับมอบหมาย) — ใช้แสดงแบนเนอร์แจ้งเตือนในหน้า worker
   คืนเฉพาะรายการที่ "เกินกำหนด" หรือ "ใกล้ครบกำหนด" (≤3 วัน) และยังทำไม่เสร็จเท่านั้น */
app.get('/api/my-due-notifications', async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        if (!sessionUser || !sessionUser.email) return res.status(401).json({ error: 'Not authenticated' });

        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();

        const assignRes = await pool.query(
            `SELECT id, tb_name, id_from, id_to, due_date, note
             FROM task_assignments
             WHERE LOWER(assignee_email) = LOWER($1) AND due_date IS NOT NULL
             ORDER BY due_date`,
            [sessionUser.email]
        );

        const items = await Promise.all(assignRes.rows.map(async (a) => {
            const tb = a.tb_name.toLowerCase();
            const total = a.id_to - a.id_from + 1;
            let done = 0;

            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
                try {
                    const colCheck = await pool.query(
                        `SELECT column_name FROM information_schema.columns
                         WHERE table_name=$1 AND column_name='classified'`, [tb]
                    );
                    if (colCheck.rowCount > 0) {
                        const doneRes = await pool.query(
                            `SELECT COUNT(*) AS cnt FROM ${tb}
                             WHERE id >= $1 AND id <= $2 AND classified = TRUE`,
                            [a.id_from, a.id_to]
                        );
                        done = parseInt(doneRes.rows[0].cnt) || 0;
                    }
                } catch (_) { /* table อาจถูกลบไปแล้ว ข้ามไปนับเป็น 0 */ }
            }

            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const { status: due_status, days_left } = computeDueStatus(a.due_date, pct);
            return { ...a, total, done, pct, due_status, days_left };
        }));

        const notifications = items.filter(it => it.due_status === 'overdue' || it.due_status === 'due_soon');
        res.json({ success: true, data: notifications });
    } catch (err) {
        console.error('[MY-DUE-NOTIFICATIONS]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ── Helper: แปลง sqm → { total_sqm, area_rai, area_ngan, area_sqwa, area_rai_decimal } ── */
function toAreaObj(sqm) {
    const s = parseFloat(sqm) || 0;
    if (s <= 0) return { total_sqm: 0, area_rai: 0, area_ngan: 0, area_sqwa: 0, area_rai_decimal: 0 };
    const rai = Math.floor(s / 1600);
    const rem = s - rai * 1600;
    return {
        total_sqm: parseFloat(s.toFixed(2)),
        area_rai: rai,
        area_ngan: Math.floor(rem / 400),
        area_sqwa: Math.floor((rem % 400) / 4),
        area_rai_decimal: parseFloat((s / 1600).toFixed(4))
    };
}
const emptyArea = { total_sqm: 0, area_rai: 0, area_ngan: 0, area_sqwa: 0, area_rai_decimal: 0 };

/* GET /api/worker-summary-all
   สรุปงานต่อคนข้ามทุก table ใน layerlist แบ่ง 3 หมวด:
   reshape (โฉนด), reclass_all, reclass_rubber (เฉพาะยางพาราลงทะเบียน) */
app.get('/api/worker-summary-all', async (req, res) => {
    try {
        const layersRes = await pool.query(`SELECT tb_name FROM layerlist ORDER BY created_at`);
        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const editorMap = {};
        const ensureEditor = (name) => {
            if (!editorMap[name]) {
                editorMap[name] = {
                    editor: name,
                    photo: photoMap[name] || null,
                    projects: [],
                    reshape:        { ...emptyArea, farmer_count: 0 },
                    reclass_all:    { ...emptyArea, sub_plot_count: 0, farmer_count: 0 },
                    reclass_rubber: { ...emptyArea, sub_plot_count: 0, farmer_count: 0 }
                };
            }
        };

        for (const layer of layersRes.rows) {
            const tb = layer.tb_name.toLowerCase();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) continue;

            // ── Reshape from main table ──
            const mainReshapeRows = await pool.query(`
                SELECT editor,
                    COUNT(*) AS farmer_count,
                    ROUND(COALESCE(SUM("Sqm_Deed"), 0)::numeric, 2) AS total_sqm
                FROM ${tb}
                WHERE editor IS NOT NULL AND editor != ''
                GROUP BY editor
            `).catch(() => ({ rows: [] }));

            const projReshape = {};
            for (const r of mainReshapeRows.rows) {
                ensureEditor(r.editor);
                const a = toAreaObj(r.total_sqm);
                const fc = parseInt(r.farmer_count);
                projReshape[r.editor] = { ...a, farmer_count: fc };
                editorMap[r.editor].reshape.total_sqm        += a.total_sqm;
                editorMap[r.editor].reshape.farmer_count     += fc;
            }

            // ── Reclass from reclass table ──
            const reclassExists = await pool.query(
                `SELECT EXISTS(SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name=$1)`,
                [`reclass_${tb}`]
            );
            const projReclassAll = {};
            const projReclassRubber = {};

            if (reclassExists.rows[0].exists) {
                const [allRes, rubberRes] = await Promise.all([
                    pool.query(`
                        SELECT editor, COUNT(*) AS sp, COUNT(DISTINCT id) AS fc,
                            ROUND(COALESCE(SUM(shpsplit_sqm),0)::numeric,2) AS total_sqm
                        FROM reclass_${tb}
                        WHERE editor IS NOT NULL AND editor != ''
                        GROUP BY editor
                    `),
                    pool.query(`
                        SELECT editor, COUNT(*) AS sp, COUNT(DISTINCT id) AS fc,
                            ROUND(COALESCE(SUM(shpsplit_sqm),0)::numeric,2) AS total_sqm
                        FROM reclass_${tb}
                        WHERE editor IS NOT NULL AND editor != ''
                            AND LOWER(TRIM(classtype)) = 'rubber'
                        GROUP BY editor
                    `)
                ]);
                for (const r of allRes.rows) {
                    ensureEditor(r.editor);
                    const a = toAreaObj(r.total_sqm);
                    const sp = parseInt(r.sp), fc = parseInt(r.fc);
                    projReclassAll[r.editor] = { ...a, sub_plot_count: sp, farmer_count: fc };
                    editorMap[r.editor].reclass_all.total_sqm    += a.total_sqm;
                    editorMap[r.editor].reclass_all.sub_plot_count += sp;
                    editorMap[r.editor].reclass_all.farmer_count  += fc;
                }
                for (const r of rubberRes.rows) {
                    ensureEditor(r.editor);
                    const a = toAreaObj(r.total_sqm);
                    const sp = parseInt(r.sp), fc = parseInt(r.fc);
                    projReclassRubber[r.editor] = { ...a, sub_plot_count: sp, farmer_count: fc };
                    editorMap[r.editor].reclass_rubber.total_sqm    += a.total_sqm;
                    editorMap[r.editor].reclass_rubber.sub_plot_count += sp;
                    editorMap[r.editor].reclass_rubber.farmer_count  += fc;
                }
            }

            // รวม project entry เฉพาะที่มีข้อมูล
            const allEditorsInProject = new Set([
                ...Object.keys(projReshape),
                ...Object.keys(projReclassAll),
                ...Object.keys(projReclassRubber)
            ]);
            for (const ed of allEditorsInProject) {
                editorMap[ed].projects.push({
                    tb_name: layer.tb_name,
                    reshape:        projReshape[ed]        || { ...emptyArea, farmer_count: 0 },
                    reclass_all:    projReclassAll[ed]     || { ...emptyArea, sub_plot_count: 0, farmer_count: 0 },
                    reclass_rubber: projReclassRubber[ed]  || { ...emptyArea, sub_plot_count: 0, farmer_count: 0 }
                });
            }
        }

        // คำนวณ rai/ngan/sqwa รวมจาก total_sqm
        const data = Object.values(editorMap).map(e => {
            ['reshape', 'reclass_all', 'reclass_rubber'].forEach(k => {
                const a = toAreaObj(e[k].total_sqm);
                Object.assign(e[k], a);
            });
            return e;
        }).sort((a, b) => b.reclass_rubber.total_sqm - a.reclass_rubber.total_sqm);

        res.json({ success: true, data });
    } catch (err) {
        console.error('[WORKER-SUMMARY-ALL]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/worker-summary/:tb
   สรุปค่าจ้างต่อคนจากยางพาราลงทะเบียน (ข้อมูลดิบ Rubr_total) เท่านั้น — เหมือนหลักการ V2 (ดู worker-summary-v2 ด้านล่าง)
   แต่ใช้ Rubr_total (ไม่ใช่ class_Area จาก reclass) เป็นฐานคิดไร่ และไม่มีโบนัสหลายคลาส:
     - โฉนดประเภท "นส.4"   → กลุ่ม ns4    (ค่าเริ่มต้น 0.5 บาท/ไร่)
     - โฉนดประเภทอื่น      → กลุ่ม other  (ค่าเริ่มต้น 1 บาท/ไร่)
   นับเฉพาะแปลงที่ทำเสร็จแล้ว (classified = TRUE) ไม่นับแปลงที่เพิ่งวาดเค้า/reshape แล้วยังไม่จำแนกที่ดิน */
app.get('/api/worker-summary/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        // ── รายละเอียดรายแปลง: ไอดีที่ทำงาน (id) เป็นประเภทเอกสารอะไร — ใช้เป็นฐานคำนวณสรุปรายคนด้านล่างด้วย ──
        const detailsRes = await pool.query(`
            SELECT id,
                COALESCE("Deed_Type", 'ไม่ระบุ') AS deed_type,
                editor,
                ROUND(COALESCE("Rubr_total", 0)::numeric, 4) AS total_rai
            FROM ${tb}
            WHERE editor IS NOT NULL AND editor != ''
                AND "Rubr_total" IS NOT NULL AND "Rubr_total" > 0
                AND classified = TRUE
            ORDER BY editor, COALESCE("Deed_Type", 'ไม่ระบุ'), id
        `);

        // ── ข้อมูลจำแนกคลาสจริงจาก reclass (ใช้แค่เป็นข้อมูลอ้างอิง/ตัวกรองในหน้าเว็บ ไม่ได้ใช้คิดเงิน — คิดเงินจาก Rubr_total เท่านั้น) ──
        // ให้ตัวกรอง "หลายคลาสเท่านั้น" / "คลาสยางพาราลงทะเบียนเท่านั้น" ในการ์ดรายแปลงทำงานได้เหมือน V2
        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        const classInfoMap = {};
        if (reclassExists.rows[0].exists) {
            const classInfoRes = await pool.query(`
                SELECT id, COUNT(*) AS cnt,
                    CASE WHEN COUNT(*) = 1 THEN MAX(LOWER(TRIM(classtype))) ELSE NULL END AS single_classtype
                FROM reclass_${tb}
                GROUP BY id
            `);
            classInfoRes.rows.forEach(r => {
                const cnt = parseInt(r.cnt);
                classInfoMap[r.id] = {
                    class_count: cnt,
                    is_multi: cnt > 1,
                    is_pure_rubber_class: cnt === 1 && r.single_classtype === 'rubber'
                };
            });
        }

        // เทียบแบบตัดจุด/ช่องว่างออกก่อน กันกรณีข้อมูลดิบสะกดไม่ตรงกันเป๊ะ เช่น "นส.4", "น.ส. 4", "นส4" — ใช้กฎเดียวกับ worker-summary-v2
        const isNs4 = (deedType) => /^นส4[ก-ฮ]?$/.test((deedType || '').replace(/[.\s]/g, ''));

        const editorMap = {};
        const ensureEditor = (name) => {
            if (!editorMap[name]) {
                editorMap[name] = {
                    editor: name,
                    photo: photoMap[name] || null,
                    total_rai: 0,
                    ns4:   { plot_count: 0, area_rai: 0, ids: [] },
                    other: { plot_count: 0, area_rai: 0, ids: [] },
                    // รายละเอียดต่อแปลง (1 แปลง = 1 รายการ) ให้ฝั่งหน้าเว็บ render การ์ดรายแปลงแบบเดียวกับ V2
                    plots: []
                };
            }
            return editorMap[name];
        };

        detailsRes.rows.forEach(r => {
            const deedType = r.deed_type;
            const rai = parseFloat(r.total_rai) || 0;
            const e = ensureEditor(r.editor);
            const isNs4Deed = isNs4(deedType);
            e.total_rai += rai;

            const group = isNs4Deed ? e.ns4 : e.other;
            group.plot_count += 1;
            group.area_rai += rai;
            group.ids.push(r.id);

            const cls = classInfoMap[r.id] || { class_count: 0, is_multi: false, is_pure_rubber_class: false };
            e.plots.push({
                id: r.id,
                deed_type: deedType,
                is_ns4: isNs4Deed,
                area_rai: rai,
                class_count: cls.class_count,
                is_multi: cls.is_multi,
                is_pure_rubber_class: cls.is_pure_rubber_class
            });
        });

        const data = Object.values(editorMap).map(e => {
            e.total_rai = parseFloat(e.total_rai.toFixed(4));
            e.ns4.area_rai = parseFloat(e.ns4.area_rai.toFixed(4));
            e.other.area_rai = parseFloat(e.other.area_rai.toFixed(4));
            e.ns4.ids.sort((a, b) => a - b);
            e.other.ids.sort((a, b) => a - b);
            e.plots.sort((a, b) => a.id - b.id);
            return e;
        }).sort((a, b) => b.total_rai - a.total_rai);

        // ── แปลงที่มีผู้ทำงานแล้วแต่ไม่ถูกนับข้างต้น (ยังไม่จำแนกที่ดิน หรือไม่มีพื้นที่ยางพาราลงทะเบียน) — แจ้งเตือนแยกไว้เหมือน V2 ──
        const warnRes = await pool.query(`
            SELECT id, editor, COALESCE("Deed_Type", 'ไม่ระบุ') AS deed_type, classified
            FROM ${tb}
            WHERE editor IS NOT NULL AND editor != ''
                AND (classified IS NOT TRUE OR "Rubr_total" IS NULL OR "Rubr_total" <= 0)
            ORDER BY editor, id
        `);
        const warnings = warnRes.rows.map(r => ({
            id: r.id,
            editor: r.editor,
            deed_type: r.deed_type,
            reason: r.classified !== true ? 'ยังไม่จำแนกที่ดิน (classified)' : 'ไม่มีพื้นที่ยางพาราลงทะเบียน (Rubr_total)'
        }));

        res.json({ success: true, data, warnings });
    } catch (err) {
        console.error('[WORKER-SUMMARY]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/worker-summary-v2/:tb
   สรุปค่าจ้าง V2 — คิดจากพื้นที่จำแนกจริง ("class_Area" ในตาราง reclass) แทนข้อมูลดิบ Rubr_total
   เงื่อนไข (ตาม id หนึ่ง ๆ ในตาราง reclass) — ให้แก้ไขค่าเริ่มต้นได้จากหน้าเว็บ:
     - ใช้ "เนื้อที่รวมทุกคลาส" (ผลรวม class_Area ของทุกคลาสย่อยในแปลงนั้น รวมถึง 'not-rubber'/'Other' ด้วย)
       เป็นฐานคิดเรทเสมอ ไม่ว่าแปลงจะมีคลาสเดียวหรือหลายคลาสก็ตาม (ต่างจาก V3 ที่จำกัดเฉพาะคลาสยางพาราลงทะเบียน
       + พื้นที่กันออกเท่านั้น — V2 ไม่จำกัด นับทุกคลาสที่จำแนกไว้ในแปลง)
         · โฉนดประเภท "นส.4"   → tier "ns4"    (ค่าเริ่มต้น 0.5 บาท/ไร่)
         · โฉนดประเภทอื่น      → tier "other"  (ค่าเริ่มต้น 1 บาท/ไร่)
     - ถ้าแปลงนั้นมีมากกว่า 1 คลาส (มีคลาสอื่นปนกับยางพารา) → บวกโบนัสเพิ่มแบบคงที่ "ต่อแปลง" (ไม่ใช่ต่อไร่)
       เข้าไปอีก tier "bonus" (ค่าเริ่มต้น 0.5 บาท/แปลง) ไม่ว่าจะเป็นนส.4 หรือโฉนดประเภทอื่นก็ตาม
     - แปลงที่ไม่มีคลาสยางพาราลงทะเบียนเลย (ไม่ว่าคลาสเดียวหรือหลายคลาส)
       → ไม่มีฐานไร่ยางให้คิดเรท ไม่คิดค่าจ้าง แจ้งเตือนแยกต่างหากให้แอดมินตรวจสอบ */

app.get('/api/worker-summary-v2/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        if (!reclassExists.rows[0].exists) {
            return res.json({ success: true, data: [], warnings: [] });
        }

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const rowsRes = await pool.query(`
            WITH class_counts AS (
                SELECT id, COUNT(*) AS cnt
                FROM reclass_${tb}
                GROUP BY id
            )
            SELECT r.id, r.editor, r.classtype,
                ROUND(COALESCE(r."class_Area", 0)::numeric, 4) AS class_area_rai,
                cc.cnt,
                COALESCE(m."Deed_Type", 'ไม่ระบุ') AS deed_type,
                COALESCE(m."Regis_No", '') AS regis_no
            FROM reclass_${tb} r
            JOIN class_counts cc ON cc.id = r.id
            LEFT JOIN ${tb} m ON m.id = r.id
            ORDER BY r.editor, r.id
        `);

        // เทียบแบบตัดจุด/ช่องว่างออกก่อน กันกรณีข้อมูลดิบสะกดไม่ตรงกันเป๊ะ เช่น "นส.4", "น.ส. 4", "นส4"
        // รวมถึงชนิดย่อยที่มีตัวอักษรต่อท้าย เช่น "นส.4จ", "น.ส.4 จ" (ยังถือเป็นโฉนดนส.4 เหมือนกัน)
        // แต่ต้องไม่ไปจับ "นส.3ก" (คนละประเภท เป็นแค่หนังสือรับรองการทำประโยชน์) จึงล็อกด้วย ^นส4 ตรงๆ
        const isNs4 = (deedType) => /^นส4[ก-ฮ]?$/.test((deedType || '').replace(/[.\s]/g, ''));

        // จัดกลุ่มแถว (แต่ละคลาสย่อยในตาราง reclass) ตาม id ก่อน เพราะโบนัสหลายคลาสคิด "ต่อแปลง" (ต่อ id)
        // ไม่ใช่ต่อคลาสย่อย จึงต้องรู้ภาพรวมทั้งแปลงก่อนตัดสินใจ
        const idGroups = {};
        rowsRes.rows.forEach(row => {
            if (!idGroups[row.id]) {
                idGroups[row.id] = {
                    id: row.id,
                    editor: row.editor,
                    deedType: row.deed_type,
                    regisNo: row.regis_no,
                    cnt: parseInt(row.cnt),
                    classRows: []
                };
            }
            idGroups[row.id].classRows.push({
                classtype: (row.classtype || '').trim().toLowerCase(),
                area: parseFloat(row.class_area_rai) || 0
            });
        });

        const editorMap = {};
        const warnings = [];

        const ensureEditor = (name) => {
            if (!editorMap[name]) {
                editorMap[name] = {
                    editor: name,
                    photo: photoMap[name] || null,
                    ns4:   { plot_count: 0, area_rai: 0, ids: [] },
                    other: { plot_count: 0, area_rai: 0, ids: [], by_deed_type: {} },
                    bonus: { plot_count: 0, sub_plot_count: 0, ids: [] },
                    // รายละเอียดต่อแปลง (1 แปลง = 1 รายการเสมอ ไม่ซ้ำ id) ให้ฝั่งหน้าเว็บ render ตารางแบบ 1 id : 1 แถว
                    plots: []
                };
            }
            return editorMap[name];
        };

        Object.values(idGroups).forEach(g => {
            const { id, editor, deedType, regisNo, cnt, classRows } = g;
            const hasEditor = editor && editor !== '';
            const hasRubber = classRows.some(c => c.classtype === 'rubber');
            const isMulti = cnt > 1;
            // ใช้เนื้อที่รวมทุกคลาสในแปลง (class_Area ของทุกคลาสย่อย) เป็นฐานคิดเรทเสมอ ไม่ว่าแปลงจะมีคลาสเดียวหรือหลายคลาส
            const payArea = classRows.reduce((sum, c) => sum + c.area, 0);

            if (!hasRubber) {
                // แปลงที่ยังเป็นแค่จุด (classtype='point') คือยังไม่ได้ขึ้นรูปแปลง/จำแนกคลาสเลย
                // ไม่ใช่ปัญหาการจำแนกคลาสผิด จึงไม่ต้องขึ้นในรายการแจ้งเตือนนี้
                if (!isMulti && classRows[0].classtype === 'point') return;

                // ไม่มีคลาสยางพาราเลย (ไม่ว่าคลาสเดียวหรือหลายคลาส) → ไม่มีฐานไร่ยางให้คิดเรท แจ้งเตือนแทน
                warnings.push({
                    id, editor: editor || 'ไม่ระบุ',
                    classtype: isMulti ? 'หลายคลาส (ไม่มียางพารา)' : (classRows[0].classtype || 'ไม่ระบุ'),
                    deed_type: deedType
                });
                return;
            }
            if (!hasEditor) return;

            const e = ensureEditor(editor);
            if (isNs4(deedType)) {
                e.ns4.plot_count += 1;
                e.ns4.area_rai += payArea;
                e.ns4.ids.push(id);
            } else {
                e.other.plot_count += 1;
                e.other.area_rai += payArea;
                e.other.ids.push(id);
                if (!e.other.by_deed_type[deedType]) {
                    e.other.by_deed_type[deedType] = { plot_count: 0, area_rai: 0, ids: [] };
                }
                e.other.by_deed_type[deedType].plot_count += 1;
                e.other.by_deed_type[deedType].area_rai += payArea;
                e.other.by_deed_type[deedType].ids.push(id);
            }

            // มากกว่า 1 คลาสในแปลงเดียวกัน (ไม่ว่าคลาสนั้นจะเข้าเงื่อนไขคิดเงินหรือไม่) → บวกโบนัสคงที่ต่อแปลงเพิ่ม
            if (isMulti) {
                e.bonus.plot_count += 1;
                e.bonus.sub_plot_count += cnt;
                e.bonus.ids.push(id);
            }

            e.plots.push({
                id,
                deed_type: deedType,
                regis_no: regisNo,
                is_ns4: isNs4(deedType),
                area_rai: parseFloat(payArea.toFixed(4)),
                is_multi: isMulti,
                class_count: cnt
            });
        });

        const data = Object.values(editorMap).map(e => {
            e.ns4.area_rai = parseFloat(e.ns4.area_rai.toFixed(4));
            e.ns4.ids.sort((a, b) => a - b);
            e.other.area_rai = parseFloat(e.other.area_rai.toFixed(4));
            e.other.ids.sort((a, b) => a - b);
            Object.values(e.other.by_deed_type).forEach(d => {
                d.area_rai = parseFloat(d.area_rai.toFixed(4));
                d.ids.sort((a, b) => a - b);
            });
            e.bonus.ids.sort((a, b) => a - b);
            e.plots.sort((a, b) => a.id - b.id);
            return e;
        }).sort((a, b) => (b.ns4.area_rai + b.other.area_rai) - (a.ns4.area_rai + a.other.area_rai));

        res.json({ success: true, data, warnings });
    } catch (err) {
        console.error('[WORKER-SUMMARY-V2]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/worker-summary-v3/:tb
   สรุปค่าจ้าง V3 — คิดจาก "class_Area" เหมือน V2 แต่จำกัดฐานพื้นที่ที่นำมาคิดเงินให้แคบลง:
     - นับเฉพาะ classtype = 'rubber' (ยางพาราที่ลงทะเบียน) และคลาสพื้นที่กันออกทุกชนิด
       ('ex_age_rubber','ex_building','ex_pond','ex_cr_area','ex_ar_area','ex_other')
     - ไม่นับ 'not-rubber' (ยางพาราที่ไม่ได้ลงทะเบียน) และ 'Other' (ไม่ใช่ยางพารา) เข้าไปในพื้นที่คิดเงินเลย
       ไม่ว่าแปลงนั้นจะมีคลาสเดียวหรือหลายคลาสก็ตาม (ต่างจาก V2 ที่ใช้เนื้อที่รวมทุกคลาสในแปลงเสมอ ไม่จำกัดคลาส)
     - อัตรา: โฉนดประเภท "นส.4" → tier "ns4" (ค่าเริ่มต้น 0.5 บาท/ไร่), โฉนดประเภทอื่น → tier "other" (ค่าเริ่มต้น 1 บาท/ไร่)
     - แปลงที่มีมากกว่า 1 คลาสในตาราง reclass (ไม่ว่าคลาสนั้นจะเข้าเงื่อนไขคิดเงินหรือไม่) → บวกโบนัสคงที่ "ต่อแปลง"
       เพิ่มอีก tier "bonus" (ค่าเริ่มต้น 0.5 บาท/แปลง) เหมือน V2
     - แปลงที่ไม่มีคลาสยางพาราลงทะเบียนหรือพื้นที่กันออกเลย (มีแต่ not-rubber/Other/point) → ไม่มีฐานไร่ให้คิดเรท
       ไม่คิดค่าจ้าง แจ้งเตือนแยกต่างหากให้แอดมินตรวจสอบ */
const PAYV3_ELIGIBLE_CLASSES = ['rubber', 'ex_age_rubber', 'ex_building', 'ex_pond', 'ex_cr_area', 'ex_ar_area', 'ex_other'];

app.get('/api/worker-summary-v3/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        if (!reclassExists.rows[0].exists) {
            return res.json({ success: true, data: [], warnings: [] });
        }

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const rowsRes = await pool.query(`
            WITH class_counts AS (
                SELECT id, COUNT(*) AS cnt
                FROM reclass_${tb}
                GROUP BY id
            )
            SELECT r.id, r.editor, r.classtype,
                ROUND(COALESCE(r."class_Area", 0)::numeric, 4) AS class_area_rai,
                cc.cnt,
                COALESCE(m."Deed_Type", 'ไม่ระบุ') AS deed_type,
                COALESCE(m."Regis_No", '') AS regis_no
            FROM reclass_${tb} r
            JOIN class_counts cc ON cc.id = r.id
            LEFT JOIN ${tb} m ON m.id = r.id
            ORDER BY r.editor, r.id
        `);

        const isNs4 = (deedType) => /^นส4[ก-ฮ]?$/.test((deedType || '').replace(/[.\s]/g, ''));

        const idGroups = {};
        rowsRes.rows.forEach(row => {
            if (!idGroups[row.id]) {
                idGroups[row.id] = {
                    id: row.id,
                    editor: row.editor,
                    deedType: row.deed_type,
                    regisNo: row.regis_no,
                    cnt: parseInt(row.cnt),
                    classRows: []
                };
            }
            idGroups[row.id].classRows.push({
                classtype: (row.classtype || '').trim().toLowerCase(),
                area: parseFloat(row.class_area_rai) || 0
            });
        });

        const editorMap = {};
        const warnings = [];

        const ensureEditor = (name) => {
            if (!editorMap[name]) {
                editorMap[name] = {
                    editor: name,
                    photo: photoMap[name] || null,
                    ns4:   { plot_count: 0, area_rai: 0, ids: [] },
                    other: { plot_count: 0, area_rai: 0, ids: [], by_deed_type: {} },
                    bonus: { plot_count: 0, sub_plot_count: 0, ids: [] },
                    plots: []
                };
            }
            return editorMap[name];
        };

        Object.values(idGroups).forEach(g => {
            const { id, editor, deedType, regisNo, cnt, classRows } = g;
            const hasEditor = editor && editor !== '';
            const isMulti = cnt > 1;
            // ต่างจาก V2: ไม่ว่าคลาสเดียวหรือหลายคลาส ให้รวมเฉพาะพื้นที่ที่เข้าเงื่อนไข (ยางพาราลงทะเบียน + พื้นที่กันออกทั้งหมด)
            // ตัด 'not-rubber' และ 'Other' ออกจากฐานคิดเงินเสมอ
            const eligibleRows = classRows.filter(c => PAYV3_ELIGIBLE_CLASSES.includes(c.classtype));
            const hasEligible = eligibleRows.length > 0;
            const payArea = eligibleRows.reduce((sum, c) => sum + c.area, 0);

            if (!hasEligible) {
                // แปลงที่ยังเป็นแค่จุด (classtype='point') คือยังไม่ได้ขึ้นรูปแปลง/จำแนกคลาสเลย ไม่ต้องขึ้นแจ้งเตือน
                if (!isMulti && classRows[0].classtype === 'point') return;

                warnings.push({
                    id, editor: editor || 'ไม่ระบุ',
                    classtype: isMulti ? 'หลายคลาส (ไม่มียางพารา/พื้นที่กันออก)' : (classRows[0].classtype || 'ไม่ระบุ'),
                    deed_type: deedType
                });
                return;
            }
            if (!hasEditor) return;

            const e = ensureEditor(editor);
            if (isNs4(deedType)) {
                e.ns4.plot_count += 1;
                e.ns4.area_rai += payArea;
                e.ns4.ids.push(id);
            } else {
                e.other.plot_count += 1;
                e.other.area_rai += payArea;
                e.other.ids.push(id);
                if (!e.other.by_deed_type[deedType]) {
                    e.other.by_deed_type[deedType] = { plot_count: 0, area_rai: 0, ids: [] };
                }
                e.other.by_deed_type[deedType].plot_count += 1;
                e.other.by_deed_type[deedType].area_rai += payArea;
                e.other.by_deed_type[deedType].ids.push(id);
            }

            // มากกว่า 1 คลาสในแปลงเดียวกัน (ไม่ว่าคลาสนั้นจะเข้าเงื่อนไขคิดเงินหรือไม่) → บวกโบนัสคงที่ต่อแปลงเพิ่ม เหมือน V2
            if (isMulti) {
                e.bonus.plot_count += 1;
                e.bonus.sub_plot_count += cnt;
                e.bonus.ids.push(id);
            }

            // ต่างจาก V2 (ที่บังคับให้ hasRubber ต้องมี classtype='rubber' อยู่จริง single-class จึงเป็น 'rubber' เสมอ) —
            // V3 ยอมรับ eligibleRows ที่เป็น ex_* ล้วนด้วย ดังนั้นแปลงคลาสเดียว (is_multi=false) อาจเป็นพื้นที่กันออกล้วน
            // ไม่ใช่ยางพาราจริงก็ได้ ต้องเช็ค classtype ตรง ๆ ว่าเป็น 'rubber' เท่านั้นถึงจะนับเป็น "ยางพาราลงทะเบียนล้วน"
            // (ดู is_pure_rubber_class ในตาราง worker-summary ปกติที่ทำแบบเดียวกันอยู่แล้ว)
            const isPureRubberClass = !isMulti && classRows[0].classtype === 'rubber';

            e.plots.push({
                id,
                deed_type: deedType,
                regis_no: regisNo,
                is_ns4: isNs4(deedType),
                area_rai: parseFloat(payArea.toFixed(4)),
                is_multi: isMulti,
                class_count: cnt,
                is_pure_rubber_class: isPureRubberClass
            });
        });

        const data = Object.values(editorMap).map(e => {
            e.ns4.area_rai = parseFloat(e.ns4.area_rai.toFixed(4));
            e.ns4.ids.sort((a, b) => a - b);
            e.other.area_rai = parseFloat(e.other.area_rai.toFixed(4));
            e.other.ids.sort((a, b) => a - b);
            Object.values(e.other.by_deed_type).forEach(d => {
                d.area_rai = parseFloat(d.area_rai.toFixed(4));
                d.ids.sort((a, b) => a - b);
            });
            e.bonus.ids.sort((a, b) => a - b);
            e.plots.sort((a, b) => a.id - b.id);
            return e;
        }).sort((a, b) => (b.ns4.area_rai + b.other.area_rai) - (a.ns4.area_rai + a.other.area_rai));

        res.json({ success: true, data, warnings });
    } catch (err) {
        console.error('[WORKER-SUMMARY-V3]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/dashboard-overview
   ภาพรวมทุกโปรเจค (ไม่แยกรายบุคคล) — สำหรับปุ่มแดชบอร์ดข้าง "สร้าง Project"
   ต่อโปรเจค (tb) หนึ่งแถว บอก:
     - target_rai: เนื้อที่เป้าหมายยางพารา รวมจากข้อมูลดิบ "Rubr_total" ในตารางหลัก
     - drawn_rai (= ns4.area_rai + other.area_rai): เนื้อที่ที่วาด/จำแนกจริงแล้วที่ "เข้าเงื่อนไขคิดเงิน" จากตาราง reclass
       ใช้กฎเดียวกับ PAYV3_ELIGIBLE_CLASSES ทุกประการ (ยางพาราลงทะเบียน 'rubber' + พื้นที่กันออกทุกชนิด 'ex_*')
       ตัด 'not-rubber'/'Other' ออกเสมอ — แยกยอดย่อยเป็น rubber_rai (เฉพาะ rubber) กับ exclude_rai (เฉพาะ ex_*) ไว้อ้างอิง
     - ns4/other/bonus/plots: โครงสร้างเดียวกับที่ /api/worker-summary-v3 คืนให้ต่อ "คนทำงาน" หนึ่งคนทุกประการ
       (ids, by_deed_type, plots[]) เพียงแต่รวมทั้งโปรเจคเป็นก้อนเดียวไม่แยก editor — เพื่อให้ฝั่งหน้าเว็บใช้ฟังก์ชัน
       buildPayV3DetailHtml เดิมสร้างการ์ดรายแปลง (พร้อมรูปย่อ/ตัวกรอง) ซ้ำได้เลยโดยไม่ต้องเขียนใหม่
     - total_plots/classified_plots: ความคืบหน้าการจำแนกที่ดินของโปรเจค (จากคอลัมน์ classified ในตารางหลัก)
   ไม่ผูกกับ editor เลย เพราะจุดประสงค์คือดูภาพรวมทั้งโปรเจค ไม่ใช่ค่าจ้างรายคน (ดู worker-summary-v3 สำหรับรายคน) */
app.get('/api/dashboard-overview', async (req, res) => {
    try {
        const layersRes = await pool.query(`SELECT tb_name, remark FROM layerlist ORDER BY created_at`);

        const projects = [];
        for (const layer of layersRes.rows) {
            const tb = layer.tb_name.toLowerCase();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) continue;

            const mainRes = await pool.query(`
                SELECT COUNT(*) AS total_plots,
                    COUNT(*) FILTER (WHERE classified = TRUE) AS classified_plots,
                    ROUND(COALESCE(SUM("Rubr_total"), 0)::numeric, 4) AS target_rai,
                    ROUND(COALESCE(SUM("Deed_total"), 0)::numeric, 4) AS deed_total_rai
                FROM ${tb}
            `).catch(() => ({ rows: [{ total_plots: 0, classified_plots: 0, target_rai: 0, deed_total_rai: 0 }] }));
            const main = mainRes.rows[0];

            const proj = {
                tb_name: layer.tb_name,
                remark: layer.remark || '',
                total_plots: parseInt(main.total_plots) || 0,
                classified_plots: parseInt(main.classified_plots) || 0,
                target_rai: parseFloat(main.target_rai) || 0,
                deed_total_rai: parseFloat(main.deed_total_rai) || 0,
                rubber_rai: 0,
                exclude_rai: 0,
                drawn_sqm: 0, // ตร.ม.จริงจาก shpsplit_sqm — ไม่ใช้ drawn_rai*1600 เพราะ class_Area ถูกปัดเศษเป็นไร่ 2 ตำแหน่งไว้ตั้งแต่ตอนสร้าง คูณกลับจะเพี้ยน
                ns4: { plot_count: 0, area_rai: 0, ids: [] },
                other: { plot_count: 0, area_rai: 0, ids: [], by_deed_type: {} },
                bonus: { plot_count: 0, sub_plot_count: 0, ids: [] },
                plots: [],
                ineligible_plot_count: 0
            };

            const reclassExists = await pool.query(
                `SELECT EXISTS(SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name=$1)`,
                [`reclass_${tb}`]
            );

            if (reclassExists.rows[0].exists) {
                const rowsRes = await pool.query(`
                    WITH class_counts AS (
                        SELECT id, COUNT(*) AS cnt
                        FROM reclass_${tb}
                        GROUP BY id
                    )
                    SELECT r.id, r.classtype,
                        ROUND(COALESCE(r."class_Area", 0)::numeric, 4) AS class_area_rai,
                        ROUND(COALESCE(r.shpsplit_sqm, 0)::numeric, 2) AS class_area_sqm,
                        cc.cnt,
                        COALESCE(m."Deed_Type", 'ไม่ระบุ') AS deed_type,
                        COALESCE(m."Regis_No", '') AS regis_no
                    FROM reclass_${tb} r
                    JOIN class_counts cc ON cc.id = r.id
                    LEFT JOIN ${tb} m ON m.id = r.id
                `);

                const isNs4 = (deedType) => /^นส4[ก-ฮ]?$/.test((deedType || '').replace(/[.\s]/g, ''));

                const idGroups = {};
                rowsRes.rows.forEach(row => {
                    if (!idGroups[row.id]) {
                        idGroups[row.id] = {
                            id: row.id, deedType: row.deed_type, regisNo: row.regis_no,
                            cnt: parseInt(row.cnt), classRows: []
                        };
                    }
                    idGroups[row.id].classRows.push({
                        classtype: (row.classtype || '').trim().toLowerCase(),
                        area: parseFloat(row.class_area_rai) || 0,
                        sqm: parseFloat(row.class_area_sqm) || 0
                    });
                });

                Object.values(idGroups).forEach(g => {
                    const { id, deedType, regisNo, cnt, classRows } = g;
                    const isMulti = cnt > 1;
                    const eligibleRows = classRows.filter(c => PAYV3_ELIGIBLE_CLASSES.includes(c.classtype));
                    const hasEligible = eligibleRows.length > 0;
                    const payArea = eligibleRows.reduce((sum, c) => sum + c.area, 0);
                    const payAreaSqm = eligibleRows.reduce((sum, c) => sum + c.sqm, 0);
                    const rubberArea = eligibleRows
                        .filter(c => c.classtype === 'rubber')
                        .reduce((sum, c) => sum + c.area, 0);

                    if (!hasEligible) {
                        if (!isMulti && classRows[0].classtype === 'point') return;
                        proj.ineligible_plot_count += 1;
                        return;
                    }

                    proj.rubber_rai += rubberArea;
                    proj.exclude_rai += (payArea - rubberArea);
                    proj.drawn_sqm += payAreaSqm;

                    const plotIsNs4 = isNs4(deedType);
                    if (plotIsNs4) {
                        proj.ns4.plot_count += 1;
                        proj.ns4.area_rai += payArea;
                        proj.ns4.ids.push(id);
                    } else {
                        proj.other.plot_count += 1;
                        proj.other.area_rai += payArea;
                        proj.other.ids.push(id);
                        if (!proj.other.by_deed_type[deedType]) {
                            proj.other.by_deed_type[deedType] = { plot_count: 0, area_rai: 0, ids: [] };
                        }
                        proj.other.by_deed_type[deedType].plot_count += 1;
                        proj.other.by_deed_type[deedType].area_rai += payArea;
                        proj.other.by_deed_type[deedType].ids.push(id);
                    }

                    if (isMulti) {
                        proj.bonus.plot_count += 1;
                        proj.bonus.sub_plot_count += cnt;
                        proj.bonus.ids.push(id);
                    }

                    // แปลงคลาสเดียว (is_multi=false) อาจเป็นพื้นที่กันออกล้วนก็ได้ (ไม่ใช่ยางพาราจริง) เพราะ V3/แดชบอร์ด
                    // ยอมรับ eligibleRows ที่เป็น ex_* ล้วนด้วย — ต้องเช็ค classtype ตรง ๆ ว่าเป็น 'rubber' เท่านั้น
                    const isPureRubberClass = !isMulti && classRows[0].classtype === 'rubber';

                    proj.plots.push({
                        id,
                        deed_type: deedType,
                        regis_no: regisNo,
                        is_ns4: plotIsNs4,
                        area_rai: parseFloat(payArea.toFixed(4)),
                        is_multi: isMulti,
                        class_count: cnt,
                        is_pure_rubber_class: isPureRubberClass
                    });
                });
            }

            proj.target_rai = parseFloat(proj.target_rai.toFixed(4));
            proj.deed_total_rai = parseFloat(proj.deed_total_rai.toFixed(4));
            proj.rubber_rai = parseFloat(proj.rubber_rai.toFixed(4));
            proj.exclude_rai = parseFloat(proj.exclude_rai.toFixed(4));
            proj.drawn_sqm = parseFloat(proj.drawn_sqm.toFixed(2));
            proj.ns4.area_rai = parseFloat(proj.ns4.area_rai.toFixed(4));
            proj.ns4.ids.sort((a, b) => a - b);
            proj.other.area_rai = parseFloat(proj.other.area_rai.toFixed(4));
            proj.other.ids.sort((a, b) => a - b);
            Object.values(proj.other.by_deed_type).forEach(d => {
                d.area_rai = parseFloat(d.area_rai.toFixed(4));
                d.ids.sort((a, b) => a - b);
            });
            proj.bonus.ids.sort((a, b) => a - b);
            proj.plots.sort((a, b) => a.id - b.id);
            proj.drawn_rai = parseFloat((proj.ns4.area_rai + proj.other.area_rai).toFixed(4));

            projects.push(proj);
        }

        res.json({ success: true, projects });
    } catch (err) {
        console.error('[DASHBOARD-OVERVIEW]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/parcel-preview/:tb/:id
   ภาพย่อรูปทรงแปลง (id เดียว) + คลาสที่จำแนกไว้ ใช้แสดงเป็น thumbnail แบบไม่ต้องเปิดหน้า reclass เต็ม
   คืนขอบเขตแปลงเดิม (จากตารางหลัก) และรูปทรง+ประเภทของทุกคลาสย่อยที่จำแนกไว้ (จากตาราง reclass) */
app.get('/api/parcel-preview/:tb/:id', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const id = parseInt(req.params.id, 10);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb) || !Number.isFinite(id)) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const [mainRes, classRes] = await Promise.all([
            pool.query(`SELECT ST_AsGeoJSON(geom) AS geom, COALESCE("Deed_Type", 'ไม่ระบุ') AS deed_type,
                    ROUND(COALESCE("Rubr_total", 0)::numeric, 4) AS rubr_total
                FROM ${tb} WHERE id = $1 LIMIT 1`, [id]),
            pool.query(`
                SELECT sub_id, classtype, "class_Area" AS class_area_rai,
                    ROUND(shpsplit_sqm::numeric, 2) AS class_area_sqm,
                    ST_AsGeoJSON(geom) AS geom
                FROM reclass_${tb} WHERE id = $1 ORDER BY sub_id
            `, [id])
        ]);

        res.json({
            success: true,
            parcel: mainRes.rows[0] && mainRes.rows[0].geom ? JSON.parse(mainRes.rows[0].geom) : null,
            deed_type: mainRes.rows[0] ? mainRes.rows[0].deed_type : null,
            // ข้อมูลดิบยางพาราลงทะเบียน (Rubr_total) จากตารางหลัก — ใช้เป็นฐานคิดเงินจริง (ดู renderParcelPreviewLayers)
            // แยกจาก class_Area (พื้นที่จำแนกจริงจากตาราง reclass) ที่โชว์เป็นรายคลาสด้านล่าง เพราะสองค่านี้อาจไม่ตรงกัน
            rubr_total: mainRes.rows[0] ? parseFloat(mainRes.rows[0].rubr_total) || 0 : 0,
            classes: classRes.rows.map(r => ({
                sub_id: r.sub_id,
                classtype: r.classtype,
                class_area_rai: r.class_area_rai !== null ? parseFloat(r.class_area_rai) : null,
                // ตร.ม. ตรงจาก shpsplit_sqm (ค่าดิบ ละเอียดกว่า class_Area ที่ถูกปัดเป็นไร่ 2 ตำแหน่งแล้ว
                // คูณกลับ — กันเลขในป๊อปอัพเพี้ยนจากตาราง reclassdash ไปหลาย ตร.ม. เพราะรอบการปัดคนละจุด)
                class_area_sqm: r.class_area_sqm !== null ? parseFloat(r.class_area_sqm) : null,
                geom: r.geom ? JSON.parse(r.geom) : null
            }))
        });
    } catch (err) {
        console.error('[PARCEL-PREVIEW]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/checker-summary/:tb
   สรุปงานตรวจ (reviewer) ต่อคนใน table เดียว */
app.get('/api/checker-summary/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        if (!reclassExists.rows[0].exists) {
            return res.json({ success: true, data: [] });
        }

        await ensureReclassReviewColumns(tb);

        const [classRes, deedRes] = await Promise.all([
            pool.query(`
                SELECT reviewer,
                    COUNT(*) AS sub_plot_count,
                    COUNT(DISTINCT id) AS farmer_count,
                    array_agg(DISTINCT id ORDER BY id) AS ids,
                    ROUND(COALESCE(SUM(shpsplit_sqm), 0)::numeric, 2) AS class_sqm
                FROM reclass_${tb}
                WHERE reviewer IS NOT NULL AND reviewer != ''
                GROUP BY reviewer
                ORDER BY class_sqm DESC
            `),
            pool.query(`
                SELECT r.reviewer,
                    ROUND(COALESCE(SUM(t."Deed_Sqm"), 0)::numeric, 2) AS deed_sqm,
                    ROUND(COALESCE(SUM(t."Rubr_Sqm"), 0)::numeric, 2) AS rubber_sqm
                FROM (
                    SELECT DISTINCT reviewer, id
                    FROM reclass_${tb}
                    WHERE reviewer IS NOT NULL AND reviewer != ''
                ) r
                JOIN ${tb} t ON t.id = r.id
                GROUP BY r.reviewer
            `)
        ]);

        const deedMap = {};
        deedRes.rows.forEach(r => {
            deedMap[r.reviewer] = {
                deed_sqm:   parseFloat(r.deed_sqm)   || 0,
                rubber_sqm: parseFloat(r.rubber_sqm) || 0
            };
        });

        const data = classRes.rows.map(r => {
            const d = deedMap[r.reviewer] || { deed_sqm: 0, rubber_sqm: 0 };
            const class_sqm = parseFloat(r.class_sqm) || 0;
            return {
                reviewer:       r.reviewer,
                photo:          photoMap[r.reviewer] || null,
                sub_plot_count: parseInt(r.sub_plot_count),
                farmer_count:   parseInt(r.farmer_count),
                ids:            r.ids || [],
                class_sqm,
                class_rai:   class_sqm / 1600,
                deed_sqm:    d.deed_sqm,
                deed_rai:    d.deed_sqm / 1600,
                rubber_sqm:  d.rubber_sqm,
                rubber_rai:  d.rubber_sqm / 1600
            };
        });

        res.json({ success: true, data });
    } catch (err) {
        console.error('[CHECKER-SUMMARY]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/pending-review/:tb
   สรุปแปลงที่ยังไม่ได้ตรวจ (reviewer ว่าง) ใน reclass_<tb> จัดกลุ่มตาม editor
   (คนที่บันทึกข้อมูล/ปรับรูปแปลงไว้) เพื่อให้เห็นว่างานของใครยังตกค้างรอตรวจ */
app.get('/api/pending-review/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        if (!reclassExists.rows[0].exists) {
            return res.json({ success: true, total_pending: 0, total_rows: 0, data: [] });
        }

        await ensureReclassReviewColumns(tb);

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const totalRes = await pool.query(`
            SELECT COUNT(*) AS total_rows,
                COUNT(*) FILTER (WHERE reviewer IS NULL OR reviewer = '') AS total_pending
            FROM reclass_${tb}
        `);

        const pendingRes = await pool.query(`
            SELECT COALESCE(NULLIF(editor, ''), 'ไม่ทราบผู้บันทึก') AS editor,
                COUNT(*) AS sub_plot_count,
                COUNT(DISTINCT id) AS farmer_count,
                array_agg(DISTINCT id ORDER BY id) AS ids
            FROM reclass_${tb}
            WHERE reviewer IS NULL OR reviewer = ''
            GROUP BY editor
            ORDER BY sub_plot_count DESC
        `);

        const data = pendingRes.rows.map(r => ({
            editor:         r.editor,
            photo:          photoMap[r.editor] || null,
            sub_plot_count: parseInt(r.sub_plot_count),
            farmer_count:   parseInt(r.farmer_count),
            ids:            r.ids || []
        }));

        res.json({
            success: true,
            total_pending: parseInt(totalRes.rows[0].total_pending) || 0,
            total_rows:    parseInt(totalRes.rows[0].total_rows) || 0,
            data
        });
    } catch (err) {
        console.error('[PENDING-REVIEW]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/needs-fix-all
   สรุปแปลงที่แอดมินตรวจแล้วแต่ "ไม่ผ่าน" (check_area/check_shape) ข้ามทุกโปรเจคใน layerlist
   จัดกลุ่มตาม editor (คนแก้ไขแปลง) เพื่อให้เห็นภาพรวมว่าของใคร โปรเจคไหน ต้องแก้ไข โดยไม่ต้องเข้าไปดูทีละโปรเจค
   ใช้กับหน้า worker ที่ต้อง auto-refresh แบบเรียลไทม์

   หมายเหตุ: ตอน worker แก้ไข landuse/geometry จริง (update_landuse, update_geometry) ระบบจะ "รีเซต"
   check_area/check_shape/reviewer/review_ts ของแถวนั้นกลับเป็น NULL ทันที (ดู saveReviewHistoryBySubId
   ก่อนรีเซตในทั้งสอง endpoint) เพื่อบังคับให้แอดมินตรวจซ้ำ — แถวที่แก้แล้วจึงไม่มีค่า 'ไม่ผ่าน' ค้างอยู่ให้เห็นอีกต่อไป
   ต้องอาศัย review_history (snapshot ก่อนรีเซตทุกครั้ง) เพื่อรู้ว่าแถวที่ตอนนี้ reviewer เป็น NULL อยู่
   เคย "ไม่ผ่าน" มาก่อนหรือไม่ ถึงจะนับเป็น "แก้ไขแล้ว รอตรวจซ้ำ" ได้ถูกต้อง (ไม่ใช่แค่แถวที่ยังไม่เคยตรวจเลย) */
app.get('/api/needs-fix-all', async (req, res) => {
    try {
        const layersRes = await pool.query(`SELECT tb_name FROM layerlist ORDER BY created_at`);
        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        await ensureReviewHistoryTable();

        const editorMap = {};
        const ensureEditor = (name) => {
            if (!editorMap[name]) {
                editorMap[name] = {
                    editor: name,
                    photo: photoMap[name] || null,
                    total_items: 0,
                    total_not_fixed: 0,
                    total_fixed_pending_review: 0,
                    projects: {}
                };
            }
            return editorMap[name];
        };
        const ensureProject = (e, tb, tbNameOriginal) => {
            if (!e.projects[tb]) e.projects[tb] = { tb_name: tbNameOriginal, items: [], not_fixed: 0, fixed_pending_review: 0 };
            return e.projects[tb];
        };

        for (const layer of layersRes.rows) {
            const tb = layer.tb_name.toLowerCase();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) continue;

            const reclassExists = await pool.query(
                `SELECT EXISTS(SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name=$1)`,
                [`reclass_${tb}`]
            );
            if (!reclassExists.rows[0].exists) continue;

            await ensureReclassReviewColumns(tb);

            // ── ยังไม่ได้แก้ไข: แถวที่ยังค้างสถานะ "ไม่ผ่าน" อยู่ตอนนี้ (worker ยังไม่ได้แตะข้อมูลเลยตั้งแต่แอดมินตรวจ) ──
            const notFixedRes = await pool.query(`
                SELECT a.id, a.sub_id, a.editor, a.check_area, a.check_shape, a.remark,
                    a.reviewer, a.review_ts, a.user_remark, a.user_remark_ts,
                    COALESCE(NULLIF(b."Full_nam", ''), CONCAT_WS(' ', b."F_name", b."L_name")) AS farm_name
                FROM reclass_${tb} a
                LEFT JOIN ${tb} b ON a.id = b.id
                WHERE a.check_area = 'ไม่ผ่าน' OR a.check_shape = 'ไม่ผ่าน'
            `).catch(() => ({ rows: [] }));

            for (const r of notFixedRes.rows) {
                const e = ensureEditor(r.editor || 'ไม่ทราบผู้แก้ไข');
                const p = ensureProject(e, tb, layer.tb_name);
                p.items.push({
                    id: r.id,
                    sub_id: r.sub_id,
                    farm_name: r.farm_name,
                    check_area: r.check_area,
                    check_shape: r.check_shape,
                    remark: r.remark,
                    reviewer: r.reviewer,
                    review_ts: r.review_ts,
                    user_remark: r.user_remark,
                    user_remark_ts: r.user_remark_ts,
                    fixed_pending_review: false
                });
                e.total_items++; e.total_not_fixed++; p.not_fixed++;
            }

            // ── แก้ไขแล้ว รอตรวจซ้ำ: ตอนนี้ยังไม่มีคนตรวจ (reviewer เป็น NULL) แต่ครั้งล่าสุดที่เคยตรวจ (จาก review_history) คือ "ไม่ผ่าน"
            //    แปลว่ามีคนแก้ไข landuse/geometry ไปแล้วหลังโดนตีกลับ กำลังรอแอดมินตรวจซ้ำ ──
            const pendingFixRes = await pool.query(`
                WITH latest_hist AS (
                    SELECT DISTINCT ON (sub_id) sub_id, check_area, check_shape, reviewer, review_ts
                    FROM review_history
                    WHERE tb_name = $1
                    ORDER BY sub_id, reset_ts DESC
                )
                SELECT a.id, a.sub_id, a.editor, a.remark, a.user_remark, a.user_remark_ts,
                    h.check_area, h.check_shape, h.reviewer, h.review_ts,
                    COALESCE(NULLIF(b."Full_nam", ''), CONCAT_WS(' ', b."F_name", b."L_name")) AS farm_name
                FROM reclass_${tb} a
                JOIN latest_hist h ON h.sub_id = a.sub_id
                LEFT JOIN ${tb} b ON a.id = b.id
                WHERE (a.reviewer IS NULL OR a.reviewer = '')
                  AND (h.check_area = 'ไม่ผ่าน' OR h.check_shape = 'ไม่ผ่าน')
            `, [tb]).catch(() => ({ rows: [] }));

            for (const r of pendingFixRes.rows) {
                const e = ensureEditor(r.editor || 'ไม่ทราบผู้แก้ไข');
                const p = ensureProject(e, tb, layer.tb_name);
                p.items.push({
                    id: r.id,
                    sub_id: r.sub_id,
                    farm_name: r.farm_name,
                    // เก็บสถานะที่เคย "ไม่ผ่าน" จาก history ไว้แสดงผลว่าติดจุดไหน (ค่าจริงในตารางตอนนี้ถูกรีเซตเป็น NULL แล้ว)
                    check_area: r.check_area,
                    check_shape: r.check_shape,
                    remark: r.remark,
                    reviewer: r.reviewer,
                    review_ts: r.review_ts,
                    user_remark: r.user_remark,
                    user_remark_ts: r.user_remark_ts,
                    fixed_pending_review: true
                });
                e.total_items++; e.total_fixed_pending_review++; p.fixed_pending_review++;
            }
        }

        const data = Object.values(editorMap)
            .map(e => ({ ...e, projects: Object.values(e.projects) }))
            .sort((a, b) => b.total_not_fixed - a.total_not_fixed || b.total_items - a.total_items);

        const summary = {
            total_items:               data.reduce((s, e) => s + e.total_items, 0),
            total_not_fixed:           data.reduce((s, e) => s + e.total_not_fixed, 0),
            total_fixed_pending_review: data.reduce((s, e) => s + e.total_fixed_pending_review, 0),
            editor_count:              data.length
        };

        res.json({ success: true, summary, data });
    } catch (err) {
        console.error('[NEEDS-FIX-ALL]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = app;

