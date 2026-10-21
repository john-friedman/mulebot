# Datasets

```tab-py
from datamulehub import datasets
```

```tab-js
import { datasets } from "datamulehub";
```

Datasets such as insider transactions and simple xbrl can be downloaded. Daily datasets can be queried via SQL syntax.


Datasets update both instantly and daily. The daily dataset takes up less space. Daily updates at 06:00 UTC Tuesday–Saturday. This is 1-2AM ET depending on Daylight Savings. We recommend if you want to refesh data at a daily interval, to pull after 09:00 UTC. Pulling after 06:15 UTC should be fine.

## Download

```tab-py
download(dataset, filename=None, from_storage="both", accession=None)
```

```tab-js
await datasets.download(dataset, { filename, from_storage: "both", accession });
```

- dataset: dataset to download
- filename: output path
- from_storage
    - "daily" : the full dataset, recombined daily at 06:00 UTC
    - "delta" : the daily delta. It updates instantly. However it is not one dataset, but many small files, that are combined when downloading. This may incur additional costs when downloading.
    - "both" : download daily and delta, and combine.
- accession: download a specific filing or a list of filings by accession.


### Example

```tab-py
from datamulehub import datasets

datasets.download(
    "xmltables/345",
    filename="345.parquet",
)
```

```tab-js
import { datasets } from "datamulehub";

await datasets.download("xmltables/345", {
    filename: "345.parquet",
});
```

## Query

You can use SQL to download query results

```tab-py
query(sql, output_dir=None)
```

```tab-js
await databases.query(sql, { output_dir });
```

- output_dir: output path

You can also get query results

```tab-py
read_query(sql)
```

```tab-js
await databases.read_query(sql);
```



### Example

```tab-py
from datamulehub import databases

databases.query(
    """
    SELECT *
    FROM "13fhr"
    LIMIT 10
    """,
    output_dir="13fhr_sample",
)
```

```tab-js
import { databases } from "datamulehub";

await databases.query(
    `SELECT *
    FROM "13fhr"
    LIMIT 10`,
    { output_dir: "13fhr_sample" },
);
```

```tab-py
from datamulehub import databases

results = databases.read_query(
    """
    SELECT *
    FROM "13fhr"
    LIMIT 10
    """,
)

print(results)
```

```tab-js
import { databases } from "datamulehub";

const results = await databases.read_query(
    `SELECT *
    FROM "13fhr"
    LIMIT 10`,
);

console.log(results);
```
