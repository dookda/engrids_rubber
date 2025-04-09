-- alter table nan_4326 add column shparea_sqm numeric;
-- UPDATE nan_4326 SET shparea_sqm = ST_Area(ST_Transform(geom, 32647));
-- alter table nan_4326 add column total_sqm numeric;
-- update nan_4326 set rai_sqm = rai * 1600;
-- update nan_4326 set ngan_sqm = ngan * 400;
-- update nan_4326 set wa_sqm = wa * 4;
-- update nan_4326 set total_sqm = rai_sqm + ngan_sqm + wa_sqm;
-- alter table nan_xls add column app_no character varying(16)
-- alter table nan_xls drop column app_no
-- update nan_xls set app_no = id_farmer
select * from public.nan_xls
select * from public.nan_4326

select a.app_no, b.app_no, b.geom
from nan_xls a
left join nan_4326 b
on a.app_no = b.app_no

-- creteate table 
CREATE TABLE v_nan_rub AS
WITH b AS (
    SELECT 
        app_no, 
        geom,
		total_sqm,
		shparea_sqm,
        ROW_NUMBER() OVER (PARTITION BY app_no ORDER BY (SELECT NULL)) AS rn
    FROM nan_4326
)
SELECT 
	a.id as xls_id,
    a.app_no as shp_app_no,
    b.app_no as xls_app_no,
	a.total_sqm as xls_sqm,
	b.total_sqm as shp_sqm,
	b.shparea_sqm,
    b.geom
FROM nan_xls a
LEFT JOIN b
    ON a.app_no = b.app_no
    AND b.rn = 1
order by a.id;

-- count rows
select count(id) from nan_xls;
select count(xls_id) from v_nan_rub where geom is not null;

-- select as geojson
SELECT xls_id,
        shp_app_no,
        xls_app_no,
        xls_sqm,
        shp_sqm,
        shparea_sqm,
        ST_ASGeoJSON(geom) AS geom
FROM v_nan_rub
WHERE geom IS NOT NULL
order by geom
