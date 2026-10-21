# SEC Filings Archive

```tab-py
from datamulehub import sec_filings_archive
```

```tab-js
import { sec_filings_archive } from "datamulehub";
```

## Tar Archive

SEC filings, parsed into constituent files, compressed individually, then put in a tar. This enables downloading specific files within filings quickly.


```tab-py
download_tar(**args)
```

```tab-js
await sec_filings_archive.download_tar(options);
```

## SGML Archive

SEC Filings in their original SGML format, compressed with zstd.

```tab-py
download_sgml(**args)
```

```tab-js
await sec_filings_archive.download_sgml(options);
```

## XBRL Archive

XBRL extracted from filings into nested json.

```tab-py
download_xbrl(**args)
```

```tab-js
await sec_filings_archive.download_xbrl(options);
```

## Arguments are shared between archives


Arguments:

- cik : company identifier
- ticker: helper function that maps tickers to cik. e.g. `MSFT`
- accession: download filings by identifier
- submission_type: type of the filing, e.g. 13F-HR
- document_type: type of the file within the filing, e.g. INFORMATION TABLE
- filing_date: date of filing
- report_date: date of report
- detected_time: when Datamule detected the filing
- contains_xbrl: does the filing contain XBRL, as inferred by Datamule.
- filename: filename within the filing
- sequence: sequence file appears within filing
- output_dir: output path
- max_workers: how many workers to use. More workers is faster.
- decomp_workers: how many workers to use. More workers is faster in Python. JavaScript accepts this option for compatibility, but decompresses on the current thread.
- decompress: whether to download compressed files, or decompress as downloading.
- tar_max_size_mb: by default, downloads files to batch tars to save on I/O. Can be disabled with `None` in Python or `null` in JavaScript.
- overwrite: whether to overwrite existing output_dir


## Example

```tab-py
from datamulehub import sec_filings_archive

# download sgml 10-K/Q for MSFT
sec_filings_archive.download_sgml(cik=320193, submission_type=["10-K", "10-Q"], output_dir="outfolder")

# download tar document ranges to outfolder/filingDate/accession/filename
sec_filings_archive.download_tar(cik=320193, document_type=["10-K", "10-Q"], output_dir="outfolder")

# download full XBRL fact JSON to outfolder/filingDate/accession.json
sec_filings_archive.download_xbrl(cik=320193, submission_type="10-K", output_dir="outfolder", tar_max_size_mb=None)
```

```tab-js
import { sec_filings_archive } from "datamulehub";

// download sgml 10-K/Q for Apple
await sec_filings_archive.download_sgml({
    cik: 320193,
    submission_type: ["10-K", "10-Q"],
    output_dir: "sgml",
});

// download tar document ranges to tar/filingDate/accession/filename
await sec_filings_archive.download_tar({
    cik: 320193,
    document_type: ["10-K", "10-Q"],
    output_dir: "tar",
});

// download full XBRL fact JSON to xbrl/filingDate/accession.json
await sec_filings_archive.download_xbrl({
    cik: 320193,
    submission_type: "10-K",
    output_dir: "xbrl",
    tar_max_size_mb: null,
});
```
