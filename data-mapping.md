# Mapeo de columnas — Google Sheet "TEST Robo Vehiculos"

Google Sheet ID: `1SwLdpHDL9HvjmyFdWwN3bd5BdCvrVgUM6DjUKCw5L7I`

Este archivo documenta el mapeo **real**, confirmado por inspección en vivo del Sheet (no solo por el Excel de muestra original), entre las columnas de la hoja y las variables internas que usa el dashboard (`data.js`).

## 1. Hallazgo importante: columnas disponibles vs. Excel de muestra

El Excel de muestra original (`Test_Robo_Vehiculos_2026.xlsx`) tenía **111 columnas**, incluyendo `LATITUD` y `LONGITUD` en grados decimales (WGS84), listas para usarse directamente en un mapa.

Al inspeccionar el Google Sheet real conectado a este dashboard, se confirmó que **solo tiene 100 columnas** (de la `A` a la `CV`) y **no incluye** `LATITUD`/`LONGITUD`, ni las columnas de geocodificación administrativa (`ColoniaGeo`, `MunicipioG`, `RegionGeo`, `AMG`, etc.).

**Consecuencia:** la única fuente de geolocalización disponible en este Sheet es:
- `wkt_geom` — formato `Point (X Y)`.
- `Xgeo` / `YGeo` — los mismos valores de `wkt_geom`, duplicados como columnas separadas (a veces con formato de miles con punto, ej. `670.853.139`, que en realidad es `670853.139`).

Por rango de valores (X entre ~600,000 y ~690,000; Y entre ~2,269,000 y ~2,306,000), se determinó que el sistema de coordenadas es **UTM Zona 13N**, cuyo EPSG estándar es **EPSG:32613**. El dashboard reproyecta estos valores a WGS84 (lat/long) en el cliente, usando `proj4js`, con la definición:

```
+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs
```

**Supuesto a validar por el usuario:** si el levantamiento original usa un datum distinto (por ejemplo, ITRF92 / NAD27 en vez de WGS84), los puntos podrían tener un corrimiento de algunos metros a unas decenas de metros. Para un dashboard de análisis agregado esto es aceptable; si se requiere precisión catastral, se recomienda validar contra puntos de control conocidos y ajustar la definición de proyección en `data.js` (función `reprojectToWGS84`).

## 2. Mapeo columna del Sheet → variable interna

| Variable interna (`data.js`) | Columna real en el Sheet | Uso en el dashboard |
|---|---|---|
| `wkt_geom` | `wkt_geom` | Geolocalización del mapa (tras reproyección) |
| `fechaHechos` | `FECHA_DE_H` | Fecha del evento, cálculo de día de la semana |
| `horaHechos` | `HORA_HECHO` | Franja horaria (madrugada/mañana/tarde/noche) |
| `mes` | `MES` | Serie mensual |
| `anio` | `AÑO` | Selector de año / filtro |
| `delito` / `especialidad` | `Delito` / `Especialid` | Validación de que el registro es robo de vehículo particular |
| `modalidad` | `Modalidad` | Referencia (Calificado/Simple) |
| `violencia` / `violenciaEst` | `Violencia` / `Violencia_` | KPI y donas con/sin violencia |
| `modusOperandi` / `modusEst` | `Modus_oper` / `MODUS_EST` | Gráfica de modus operandi |
| `municipio` | `MUNICIPIO` | Filtro y agregados por municipio |
| `colonia` | `COLONIA` | Top colonias |
| `zonaGeo` → `sector` | `ZonaGeo` | Top sectores (ej. `GU07`, `ZP04`, `TL01`) |
| `marca` / `submarca` | `Marca` / `Submarca` | Top marcas y submarcas |
| `situacion` / `estatusCi` | `SituaciOn` / `ESTATUS_CI` | Detección de estatus de recuperación/detención (ver punto 4) |

## 3. Columnas EXCLUIDAS deliberadamente (gobernanza de datos)

Estas columnas existen en el Sheet pero **nunca** deben mostrarse, exportarse, ni incluirse en tooltips/popups/tablas, por ser datos personales o sensibles:

`Usu_CREO_E`, `Serie`, `Placa`, `NUC`, `NUMnuC`, `OBS_EST`, `Observac`, `REV_EST`, `CALLE`, `NUM_INTE`, `NUM_EXT`, `ENTRE_1`, `ENTRE_2`, `LUGAR_REFE`, `OBJETOS_RO`, `EMPRESA`, `CantMascul`, `CantFemeni`, `CantDescon`, `TotalVicti`, `IdGeo`, `CalleGeo`, `CruceGeo`.

Esta lista vive como constante `SENSITIVE_COLUMNS` en `data.js`. Si se agregan columnas nuevas al Sheet, **revisar primero si son sensibles** antes de mapearlas a alguna sección del dashboard.

## 4. Datos NO disponibles en este dataset (v1)

El Sheet actual es un listado de **casos individuales** (muestra cruda de Fiscalía), no una tabla ya agregada de indicadores operativos. Por eso, dos secciones del dashboard (9. Detenidos y aseguramientos, 10. Vehículos recuperados) **no tienen todavía una fuente de datos confirmada**:

- No se identificó una columna explícita tipo "¿fue detenido el probable responsable?" o "¿fue recuperado el vehículo?". El campo `SituaciOn` existe en el esquema pero, en la muestra inspeccionada, apareció vacío en todos los registros.
- El dashboard ya está preparado para poblar estas secciones automáticamente en cuanto el campo `SituaciOn` (o uno nuevo, ej. `RECUPERADO`, `DETENIDO`) tenga valores reales — no requiere cambios de código, solo ajustar la lógica de `computeAggregates()` en `data.js` una vez que el usuario confirme el nombre y los valores posibles de esa columna.

## 4bis. Columna `MunicipioG` (gráfica de municipios y desambiguación de colonias)

Se agregó una gráfica de "Top municipios" que usa la columna geocodificada `MunicipioG`. Al momento de esta actualización, esa columna **no estaba presente** en el Sheet conectado (ver punto 1), por lo que `data.js` aplica automáticamente un *fallback* a la columna `MUNICIPIO` (ya mapeada) mientras `MunicipioG` no exista. En cuanto Fiscalía incorpore `MunicipioG` al Sheet, el dashboard la tomará automáticamente sin cambios de código.

Además, la tabla y gráfica de colonias ahora muestran el **municipio (columna `MUNICIPIO`)** junto a cada colonia, para distinguir colonias homónimas que existen en más de un municipio del AMG (ej. "Centro" en Guadalajara vs. "Centro" en Tlaquepaque).

## 5. Cómo agregar más años (v2+)

1. Agregar las filas de años adicionales (2024, 2025, 2027…) al mismo Sheet, respetando exactamente los mismos encabezados de columna.
2. El dashboard detecta automáticamente los años presentes en la columna `AÑO` y los agrega al selector de año y a las series del comparativo mensual — no requiere tocar código.
3. Si Fiscalía entrega los años adicionales en pestañas (tabs) separadas del mismo Sheet en lugar de filas nuevas, ajustar `APP_CONFIG.SHEET_TAB_NAME` en `data.js`, o extender `fetchSheetRows()` para iterar sobre varias pestañas y concatenar resultados.
