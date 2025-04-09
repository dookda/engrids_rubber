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
                        shp_app_no,
                        xls_app_no,
                        xls_sqm,
                        shp_sqm,
                        shparea_sqm,
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

app.post('/api/updatefeatures', async (req, res) => {
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
                    UPDATE tb_nan_rub
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(ST_Transform(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                            32647
                        ))
                    WHERE id = $2
                `, [
                    JSON.stringify(feature.geometry),
                    feature.properties.id
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

app.post('/api/calarea', async (req, res) => {
    try {
        const { geometry, srid } = req.body;

        if (!geometry || !geometry.type || !geometry.coordinates) {
            return res.status(400).json({ error: 'Invalid GeoJSON geometry' });
        }

        const targetSRID = parseInt(srid) || 32647;
        const result = await pool.query(`
            SELECT 
                ST_Area(
                    ST_Transform(
                        ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        ${targetSRID}
                    )
                )
                AS area
            `,
            [JSON.stringify(geometry)]  // Use parsed integer
        );

        if (!result.rows[0]?.area) {
            return res.status(400).json({ error: 'Area calculation failed' });
        }

        res.json({
            success: true,
            area: result.rows[0].area,
            units: 'square meters',
            srid: targetSRID,
            geometry_type: geometry.type
        });

    } catch (err) {
        console.error('Area calculation error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Ensure valid GeoJSON and SRID exists in spatial_ref_sys'
        });
    }
});

// POST endpoint to split polygon with line
app.post('/api/split-polygon', async (req, res) => {
    try {
        const { polygon, line, srid } = req.body;

        // Validate input
        if (!polygon?.type || polygon.type !== 'Polygon' || !polygon.coordinates) {
            return res.status(400).json({ error: 'Invalid polygon GeoJSON' });
        }

        if (!line?.type || !['LineString', 'MultiLineString'].includes(line.type) || !line.coordinates) {
            return res.status(400).json({ error: 'Invalid line GeoJSON' });
        }

        // Perform split operation
        const result = await pool.query(`
            WITH inputs AS (
                SELECT 
                    ST_Force2D(ST_GeomFromGeoJSON($1)) AS poly,
                    ST_Force2D(ST_GeomFromGeoJSON($2)) AS line,
                    $3::integer AS target_srid
            ),
            transformed AS (
                SELECT 
                    ST_Transform(poly, target_srid) AS poly,
                    ST_Transform(line, target_srid) AS line,
                    target_srid
                FROM inputs
            ),
            split AS (
                SELECT ST_Split(poly, line) AS split_geom
                FROM transformed
            ),
            parts AS (
                SELECT (ST_Dump(split_geom)).geom
                FROM split
            )
            SELECT 
                ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geometry,
                ST_Area(geom) AS area,
                target_srid AS srid
            FROM parts, transformed
            WHERE ST_GeometryType(geom) = 'ST_Polygon'
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647
        ]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'No split results - check input geometries' });
        }

        console.log('Split result:', result.rows);


        const features = result.rows.map(row => ({
            type: 'Feature',
            geometry: JSON.parse(row.geometry),
            properties: {
                area: row.area,
                units: 'square meters',
                srid: row.srid
            }
        }));

        res.json({
            type: 'FeatureCollection',
            features
        });

    } catch (err) {
        console.error('Split error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Ensure valid intersecting geometries'
        });
    }
});

// export module
module.exports = app;
