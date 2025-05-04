const express = require('express');
const app = express.Router();
const { Pool } = require('pg');

const bodyParser = require('body-parser');
const path = require('path');

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

// get all users
app.get('/api/getfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const sql = `SELECT id,
                        refinal,
                        shp_app_no,
                        xls_app_no,
                        xls_sqm,
                        shp_sqm,
                        shparea_sqm,
                        classified,
                        ST_ASGeoJSON(geom) AS geom
                    FROM tb_rub_${tb}
                    WHERE geom IS NOT NULL`;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/getfeatures/:tb/:fid', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const fid = req.params.fid;
        if (!fid) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        const sql = `SELECT id, 
                        sub_id, 
                        classtype, 
                        xls_app_no, 
                        shpsplit_sqm, 
                        ST_ASGeoJSON(geom) AS geom
                    FROM tb_rub_reclass_${tb}
                    WHERE geom IS NOT NULL AND id = $1`;
        const values = [fid];
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

app.put('/api/updateselectedfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;

        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { features } = req.body;
        const client = await pool.connect();
        if (!features || !Array.isArray(features)) {
            return res.status(400).json({ error: 'Invalid input data' });
        }
        if (features.length === 0) {
            return res.status(400).json({ error: 'No features to update' });
        }

        try {
            await client.query('BEGIN');

            const queries = features.map(feature =>
                client.query(`
                    UPDATE tb_rub_reclass_${tb}
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326):: geography
                        )
                    WHERE sub_id = $2
                `, [
                    JSON.stringify(feature.geometry),
                    feature.properties.sub_id
                ])
            );

            await Promise.all(queries);
            await client.query('COMMIT');
            res.json({ success: true, updated: features.length });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/updatefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { id, refinal, features } = req.body;

        const client = await pool.connect();
        if (!features || !Array.isArray(features)) {
            return res.status(400).json({ error: 'Invalid input data' });
        }
        if (features.length === 0) {
            return res.status(400).json({ error: 'No features to update' });
        }

        try {
            await client.query('BEGIN');
            const queries = features.map(feature =>
                client.query(`
                    UPDATE tb_rub_${tb}
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326):: geography
                        ),
                        refinal = $3
                    WHERE id = $2
                `, [
                    JSON.stringify(feature.geometry),
                    id,
                    refinal
                ])
            );

            await Promise.all(queries);
            await client.query('COMMIT');

            res.json({ success: true, updated: features[0].properties.id });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/getreclassfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const sql = `SELECT a.id,
                    a.sub_id,
                    b.refinal,
                    a.classtype, 
                    a.xls_app_no,
                    b.shparea_sqm,
                    a.shpsplit_sqm,
                    ST_ASGeoJSON(a.geom) AS geom FROM tb_rub_reclass_${tb} a
                LEFT JOIN tb_rub_${tb} b
                ON a.id = b.id
                WHERE a.geom IS NOT NULL`;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/countsfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const query = `
        WITH a AS (
            SELECT COUNT(*) AS reshp
            FROM tb_rub_${tb}
            WHERE ABS(xls_sqm - shparea_sqm) <= 100
        ),
        c AS (
            SELECT COUNT(DISTINCT id) AS reclass
            FROM tb_rub_reclass_${tb}
        )
        SELECT (SELECT COUNT(*) FROM tb_rub_${tb}) AS total,
                c.reclass,
                a.reshp
        FROM a
        CROSS JOIN c;
      `;
        const result = await pool.query(query);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.post('/api/create_reclass_layer/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
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
                DELETE FROM tb_rub_reclass_${tb}
                WHERE id = $1
                RETURNING id  
            )
            INSERT INTO tb_rub_reclass_${tb} (id, sub_id, xls_app_no, shpsplit_sqm, geom)
            SELECT id, $2, xls_app_no, shparea_sqm, geom
            FROM tb_rub_${tb}
            WHERE id = $1
            RETURNING id, xls_app_no, ST_AsGeoJSON(geom) AS geom;
        `;
        const values = [id, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in source table' });
        }

        // uudate reclass column
        const updateSql = `
            UPDATE tb_rub_${tb}
            SET classified = TRUE
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

app.post('/api/splitfeature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { polygon_fc, line_fc, srid } = req.body;
        const polygon = polygon_fc.geometry;
        const line = line_fc.geometry;
        const properties = polygon_fc.properties;
        const id = polygon_fc.properties.id;
        const sub_id = polygon_fc.properties.sub_id;

        if (!properties?.xls_app_no) {
            return res.status(400).json({ error: 'xls_app_no is required in properties' });
        }

        if (!polygon?.type || !['Polygon', 'MultiPolygon'].includes(polygon.type) || !polygon.coordinates) {
            return res.status(400).json({ error: 'Invalid polygon GeoJSON' });
        }
        if (!line?.type || !['LineString', 'MultiLineString'].includes(line.type) || !line.coordinates) {
            return res.status(400).json({ error: 'Invalid line GeoJSON' });
        }

        const result = await pool.query(`
            WITH delete_existing AS (
                DELETE FROM tb_rub_reclass_${tb} 
                WHERE sub_id LIKE $5 || '%'
                RETURNING sub_id
            ),
            inputs AS (
                SELECT 
                    ST_Force2D(ST_GeomFromGeoJSON($1)) AS poly,
                    ST_Force2D(ST_GeomFromGeoJSON($2)) AS line,
                    $3::integer AS processing_srid
            ),
            transformed AS (
                SELECT 
                    ST_Transform(poly, processing_srid) AS poly_projected,
                    ST_Transform(line, processing_srid) AS line_projected
                FROM inputs
            ),
            split AS (
                SELECT ST_Split(poly_projected, line_projected) AS split_geom
                FROM transformed
            ),
            parts AS (
                SELECT (ST_Dump(split_geom)).geom AS geom_projected 
                FROM split
            ),
            inserted AS (
                INSERT INTO tb_rub_reclass_${tb} (xls_app_no, geom, sub_id, id, classtype, shpsplit_sqm)
                SELECT 
                    $4, 
                    ST_Transform(geom_projected, 4326), 
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7, 
                    ST_Area(geom_projected)
                FROM parts, inputs
                WHERE ST_GeometryType(geom_projected) = 'ST_Polygon'
                RETURNING *
            )
            SELECT 
                id, 
                sub_id, 
                classtype, 
                xls_app_no, 
                shpsplit_sqm, 
                ST_ASGeoJSON(geom) AS geom
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.xls_app_no,
            sub_id,
            id,
            properties.classtype
        ]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'No split results - check input geometries' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        console.error('Split error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Ensure valid intersecting geometries'
        });
    }
});

app.put('/api/update_landuse/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { sub_id, classtype } = req.body;
        if (!sub_id || !classtype) {
            return res.status(400).json({ error: 'ID and classtype are required' });
        }

        const sql = `
            UPDATE tb_rub_reclass_${tb}
            SET classtype = $1
            WHERE sub_id = $2
            RETURNING *;
        `;
        const values = [classtype, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/area', async (req, res) => {
    const geojson = req.body;
    const geometry = geojson.geometry || geojson;
    if (!geometry || !geometry.type) {
        return res.status(400).json({ error: 'Missing GeoJSON geometry' });
    }

    try {
        const sql = `
        SELECT ST_Area(
          ST_SetSRID(
            ST_GeomFromGeoJSON($1),
            4326
          )::geography
        ) AS area;
      `;
        const { rows } = await pool.query(sql, [JSON.stringify(geometry)]);
        return res.json({ area: rows[0].area });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/split', async (req, res) => {
    const { polygon_fc, line_fc, srid } = req.body;

    try {
        const sql = `
        WITH inputs AS (
          SELECT
            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS poly_geom,
            ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS line_geom
        ),
        split AS (
          SELECT ST_Split(poly_geom, line_geom) AS geom_collection
          FROM inputs
        ),
        dumped AS (
          -- Dump each piece out of the GeometryCollection
          SELECT (ST_Dump(geom_collection)).geom AS part_geom
          FROM split
        )
        SELECT ST_AsGeoJSON(part_geom) AS geojson
        FROM dumped;
      `;
        const params = [
            JSON.stringify(polygon_fc.geometry),
            JSON.stringify(line_fc.geometry)
        ];
        const { rows } = await pool.query(sql, params);

        // Parse each GeoJSON string back to an object
        const features = rows.map(r => ({
            type: 'Feature',
            geometry: JSON.parse(r.geojson),
            properties: {}
        }));

        // Wrap as FeatureCollection
        // res.json({
        //     type: 'FeatureCollection',
        //     features
        // });

        res.status(200).json({
            success: true, data: {
                type: 'FeatureCollection',
                features
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/download/reshape/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        // console.log('tb:', tb);

        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { rows } = await pool.query(`
        SELECT json_build_object(
          'type',     'FeatureCollection',
          'features', json_agg(features.feature)
        ) AS geojson
        FROM (
          SELECT json_build_object(
            'type',       'Feature',
            'geometry',   ST_AsGeoJSON(geom)::json,
            'properties', to_jsonb(props) - 'geom'
          ) AS feature
          FROM (
            SELECT *
            FROM tb_rub_${tb}
            WHERE geom IS NOT NULL
          ) AS props
        ) AS features;
      `);

        const geojson = rows[0].geojson;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="data.geojson"'
        );
        res.send(JSON.stringify(geojson));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


// export module
module.exports = app;
