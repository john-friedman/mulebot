# Transfer to your Cloud

```tab-py
from datamulehub import object_transfer
```

```tab-js
import { object_transfer } from "datamulehub";
```

Note that sec_filings_notifications reports when filings have been detected, not when they are in datamule. Good practice to add retries.

## Credentials

### S3

```tab-py
s3_credentials = {
    "aws_access_key_id": "...",
    "aws_secret_access_key": "...",
    "region_name": "us-east-1",
    "bucket_name": "your-bucket",
}
```

```tab-js
const s3_credentials = {
    aws_access_key_id: "...",
    aws_secret_access_key: "...",
    region_name: "us-east-1",
    bucket_name: "your-bucket",
};
```

## Updating Daily

### Datasets

Datasets update both instantly and daily. The daily dataset takes up less space. Daily updates at 06:00 UTC Tuesday–Saturday. This is 1-2AM ET depending on Daylight Savings. We recommend if you want to refesh data at a daily interval, to pull after 09:00 UTC. Pulling after 06:15 UTC should be fine.

#### Example

```tab-py
object_transfer.transfer_dataset_s3(
    datasets=["simple_xbrl", "xml2tables/dos"],
    s3_credentials=s3_credentials,
    prefix="datamule",
)
```

```tab-js
await object_transfer.transfer_dataset_s3({
    datasets: ["simple_xbrl", "xml2tables/dos"],
    s3_credentials,
    prefix: "datamule",
});
```

Note: You can use SQL [queries](datasets.md) to transfer just the delta, using filing-date.

### Archives

Archives update instantly. Arguments are similar to [downloading filings](sec_filings_archive.md).

#### Examples

```tab-py
object_transfer.transfer_sgml_archive_s3(
    s3_credentials=s3_credentials,
    filing_date="YYYY-MM-DD",
    prefix="sec-filings",
)
```

```tab-js
await object_transfer.transfer_sgml_archive_s3({
    s3_credentials,
    filing_date: "YYYY-MM-DD",
    prefix: "sec-filings",
});
```

```tab-py
object_transfer.transfer_tar_archive_s3(
    s3_credentials=s3_credentials,
    filing_date="YYYY-MM-DD",
    prefix="sec-filings",
)
```

```tab-js
await object_transfer.transfer_tar_archive_s3({
    s3_credentials,
    filing_date: "YYYY-MM-DD",
    prefix: "sec-filings",
});
```

```tab-py
object_transfer.transfer_xbrl_archive_s3(
    s3_credentials=s3_credentials,
    filing_date="YYYY-MM-DD",
    prefix="sec-filings",
)
```

```tab-js
await object_transfer.transfer_xbrl_archive_s3({
    s3_credentials,
    filing_date: "YYYY-MM-DD",
    prefix: "sec-filings",
});
```


## Updating Instantly

### Examples

Archives

```tab-py
from datamulehub import object_transfer, sec_filings_notifications

for filing in sec_filings_notifications.stream_filings():
    if filing["submission_type"] == "10-K":
        for transfer, prefix in (
            (object_transfer.transfer_sgml_archive_s3, "sgml"),
            (object_transfer.transfer_tar_archive_s3, "tar"),
            (object_transfer.transfer_xbrl_archive_s3, "xbrl"),
        ):
            transfer(
                s3_credentials=s3_credentials,
                accession=[filing["accession"]],
                prefix=prefix,
            )
```

```tab-js
import { object_transfer, sec_filings_notifications } from "datamulehub";

for await (const filing of sec_filings_notifications.stream_filings()) {
    if (filing.submission_type === "10-K") {
        for (const [transfer, prefix] of [
            [object_transfer.transfer_sgml_archive_s3, "sgml"],
            [object_transfer.transfer_tar_archive_s3, "tar"],
            [object_transfer.transfer_xbrl_archive_s3, "xbrl"],
        ]) {
            await transfer({
                s3_credentials,
                accession: [filing.accession],
                prefix,
            });
        }
    }
}
```

Datasets are tricky, because there are many small files within the SEC corpus. An insider transaction filing may be a few kb. This is smaller than the minimum S3 size used for billing. An insider transaction filing may contain multiple tables when processed by datamule. Many small tables make sense for daily datasets, as they combine into one big dataset. However for instant updates this produces a problem.

If you want to cast to individual s3 files, it is recommended to use the following. Note that S3 Express is good for small files.

```tab-py
from datamulehub import datasets, sec_filings_notifications

for filing in sec_filings_notifications.stream_filings():
    if filing["submission_type"] == "10-K":
        accession = filing["accession"]

        datasets.download(
            "simple_xbrl",
            accession=[accession],
            filename=f"{accession}.parquet",
        )

        # do something with file
```

```tab-js
import { datasets, sec_filings_notifications } from "datamulehub";

for await (const filing of sec_filings_notifications.stream_filings()) {
    if (filing.submission_type === "10-K") {
        const accession = filing.accession;

        await datasets.download("simple_xbrl", {
            accession: [accession],
            filename: `${accession}.parquet`,
        });

        // do something with file
    }
}
```

If you want to submit to a database, such as PostgreSQL, it is recommended to grab the data, then submit to your database.

## Filling missing data.

If data is missing, simply use the accession parameter to fill them in.

## Improvements coming to this page

- QoL improvements
- GCS and other providers
