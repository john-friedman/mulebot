# SEC Filings Lookup

```tab-py
from datamulehub import sec_filings_lookup
```

```tab-js
import { sec_filings_lookup } from "datamulehub";
```

This is mostly a helper for other functions, but exposed to the user in case they find it useful.

## SGML Lookup

Look up SEC filings in the SGML archive. Returns columns: `accession`, `filingDate`.


```tab-py
lookup_sgml(**args)
```

```tab-js
await sec_filings_lookup.lookup_sgml(options);
```

Yields one page at a time instead of returning everything at once.

```tab-py
stream_sgml(**args)
```

```tab-js
for await (const page of sec_filings_lookup.stream_sgml(options)) {
    console.log(page);
}
```

## Tar Lookup

Look up SEC filings in the tar archive. Returns columns: `accession`, `filingDate`, `start`, `end`. `start` and `end` are byte ranges, which enable downloading specific files within filings.


```tab-py
lookup_tar(**args)
```

```tab-js
await sec_filings_lookup.lookup_tar(options);
```

Yields one page at a time instead of returning everything at once.

```tab-py
stream_tar(**args)
```

```tab-js
for await (const page of sec_filings_lookup.stream_tar(options)) {
    console.log(page);
}
```

## Arguments are shared between lookups


Arguments:

- cik : company identifier
- ticker: helper function that maps tickers to cik. e.g. `MSFT`
- accession: look up filings by identifier
- submission_type: type of the filing, e.g. 13F-HR
- document_type: type of the file within the filing, e.g. INFORMATION TABLE
- filing_date: date of filing. Pass a 2-tuple in Python or a two-item array in JavaScript for a range.
- report_date: date of report. Pass a 2-tuple in Python or a two-item array in JavaScript for a range.
- detected_time: when Datamule detected the filing. Pass a 2-tuple in Python or a two-item array in JavaScript for a range.
- contains_xbrl: does the filing contain XBRL, as inferred by Datamule.
- filename: filename within the filing
- sequence: sequence file appears within filing
- page: fetch a single page. By default, all pages are fetched.

Python accepts lists, tuples and sets for filters and matches them as multiple values. JavaScript accepts arrays for filters; date and time arrays represent ranges.

## Example

```tab-py
from datamulehub import sec_filings_lookup

# get tar byte ranges for Apple 10-Ks and 10-Qs
results = sec_filings_lookup.lookup_tar(cik=320193, document_type=["10-K", "10-Q"])

# results is columnar: {"accession": [...], "filingDate": [...], "start": [...], "end": [...]}

# stream large result sets one page at a time
for page in sec_filings_lookup.stream_sgml(submission_type="10-K", filing_date=("2024-01-01", "2024-12-31")):
    print(page["accession"][:5])
```

```tab-js
import { sec_filings_lookup } from "datamulehub";

// get tar byte ranges for Apple 10-Ks and 10-Qs
const results = await sec_filings_lookup.lookup_tar({
    cik: 320193,
    document_type: ["10-K", "10-Q"],
});

// results is columnar: { accession: [...], filingDate: [...], start: [...], end: [...] }

// stream large result sets one page at a time
for await (const page of sec_filings_lookup.stream_sgml({
    submission_type: "10-K",
    filing_date: ["2024-01-01", "2024-12-31"],
})) {
    console.log(page.accession.slice(0, 5));
}
```
