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

        console.log(`Updating ${features.length} features...`);

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
                        shp_sqm = $2
                    WHERE xls_id = $3
                `, [
                    JSON.stringify(feature.geometry),
                    feature.properties.shp_sqm,
                    feature.properties.xls_id
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

// export module
module.exports = app;
