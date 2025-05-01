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

// cal area wt

// get all users
app.get('/api/getfeatures', async (req, res) => {
    try {
        const sql = `SELECT id,
                        refinal,
                        shp_app_no,
                        xls_app_no,
                        xls_sqm,
                        shp_sqm,
                        shparea_sqm,
                        classtype,
                        ST_ASGeoJSON(geom) AS geom
                    FROM tb_nan_rub
                    WHERE geom IS NOT NULL`;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// get all feature as feature collection
app.get('/api/getfeaturescollection', async (req, res) => {
    try {
        const sql = `SELECT id,
                        sub_id,
                        shp_app_no,
                        xls_app_no,
                        xls_sqm,
                        shp_sqm,
                        shparea_sqm,
                        classtype,
                        ST_ASGeoJSON(geom) AS geom
                    FROM tb_nan_rub
                    WHERE geom IS NOT NULL`;
        const result = await pool.query(sql);
        const featureCollection = {
            type: 'FeatureCollection',
            features: result.rows.map(row => ({
                type: 'Feature',
                properties: {
                    id: row.id,
                    sub_id: row.sub_id,
                    shp_app_no: row.shp_app_no,
                    xls_app_no: row.xls_app_no,
                    xls_sqm: row.xls_sqm,
                    shp_sqm: row.shp_sqm,
                    classtype: row.classtype,
                    shparea_sqm: row.shparea_sqm
                },
                geometry: JSON.parse(row.geom)
            }))
        };
        res.status(200).json({ success: true, data: featureCollection });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/getfeatures/:fid', async (req, res) => {
    try {
        const fid = req.params.fid;
        if (!fid) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        const sql = `SELECT id, sub_id, classtype, xls_app_no, shparea_sqm, ST_ASGeoJSON(geom) AS geom
                    FROM tb_nan_rub_reclass
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

app.put('/api/updateselectedfeatures', async (req, res) => {
    try {
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
                    UPDATE tb_nan_rub_reclass
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(ST_Transform(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                            32647
                        ))
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

app.post('/api/updatefeatures', async (req, res) => {
    try {
        const { id, refinal, features } = req.body;
        // console.log(features);

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
                    UPDATE tb_nan_rub
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(ST_Transform(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                            32647
                        )),
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

app.get('/api/getreclassfeatures', async (req, res) => {
    try {
        const sql = `SELECT sub_id as id,
                        id as parent_id,
                        classtype, 
                        xls_app_no,
                        xls_sqm,
                        shparea_sqm,
                        ST_ASGeoJSON(geom) AS geom
                    FROM tb_nan_rub_reclass
                    WHERE geom IS NOT NULL`;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/countsfeatures', async (req, res) => {
    try {
        const query = `
        WITH a AS (
            SELECT COUNT(*) AS reshp
            FROM public.tb_nan_rub
            WHERE ABS(xls_sqm - shparea_sqm) <= 100
        ),
        c AS (
            SELECT COUNT(DISTINCT id) AS reclass
            FROM public.tb_nan_rub_reclass
        )
        SELECT (SELECT COUNT(*) FROM public.tb_nan_rub) AS total,
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

app.post('/api/create_reclass_layer', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        const sub_id = new Date().getTime();
        const sql = `
            WITH delete_existing AS (
                DELETE FROM tb_nan_rub_reclass 
                WHERE id = $1
                RETURNING id  
            )
            INSERT INTO tb_nan_rub_reclass (id, sub_id, xls_app_no, xls_sqm, shparea_sqm, geom)
            SELECT id, $2, xls_app_no, xls_sqm, shparea_sqm, geom
            FROM tb_nan_rub
            WHERE id = $1
            RETURNING id, xls_app_no, xls_sqm, ST_AsGeoJSON(geom) AS geom;
        `;
        const values = [id, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in source table' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/split_react', async (req, res) => {
    try {
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
                DELETE FROM tb_nan_rub
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
                INSERT INTO tb_nan_rub (xls_app_no, geom, sub_id, id, classtype, shparea_sqm, xls_sqm)
                SELECT 
                    $4, 
                    ST_Transform(geom_projected, 4326), 
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7, 
                    ST_Area(geom_projected),
                    $8
                FROM parts, inputs
                WHERE ST_GeometryType(geom_projected) = 'ST_Polygon'
                RETURNING *
            )
            SELECT 
                id, 
                sub_id, 
                classtype, 
                xls_app_no, 
                shparea_sqm, 
                ST_ASGeoJSON(geom) AS geom,
                xls_sqm
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.xls_app_no,
            sub_id,
            id,
            properties.classtype,
            properties.xls_sqm,
        ]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'No split results - check input geometries' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Ensure valid intersecting geometries'
        });
    }
});

app.post('/api/split', async (req, res) => {
    try {
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
                DELETE FROM tb_nan_rub_reclass 
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
                INSERT INTO tb_nan_rub_reclass (xls_app_no, geom, sub_id, id, classtype, shparea_sqm, xls_sqm)
                SELECT 
                    $4, 
                    ST_Transform(geom_projected, 4326), 
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7, 
                    ST_Area(geom_projected),
                    $8
                FROM parts, inputs
                WHERE ST_GeometryType(geom_projected) = 'ST_Polygon'
                RETURNING *
            )
            SELECT 
                id, 
                sub_id, 
                classtype, 
                xls_app_no, 
                shparea_sqm, 
                ST_ASGeoJSON(geom) AS geom,
                xls_sqm
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.xls_app_no,
            sub_id,
            id,
            properties.classtype,
            properties.xls_sqm,
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

app.put('/api/update_landuse', async (req, res) => {
    try {
        const { sub_id, classtype } = req.body;
        if (!sub_id || !classtype) {
            return res.status(400).json({ error: 'ID and classtype are required' });
        }

        const sql = `
            UPDATE tb_nan_rub_reclass
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

// export module
module.exports = app;
