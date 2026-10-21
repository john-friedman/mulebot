# Products

Some products require a monthly subscription. Usage costs are separate and deducted from your account balance. All prices are in USD.

You can manage subscriptions and add credits in the [dashboard](/dashboard). If you cancel a subscription, you retain access until the end of the current billing period.

R2 lookups, S3 downloads, Athena queries, and Fastest SEC Filings Metadata queries have a minimum charge of $0.001 per request. Athena queries are charged for data scanned; downloading the query results also incurs S3 download costs.

## Included

Cost: $0/month. Usage costs still apply where listed.

### SEC Filings SGML R2

SEC filings in their original SGML format. See [SEC Filings Archive](sec_filings_archive.md).

Usage cost:

- R2 lookups: $1 per million results returned.

### SEC Filings TAR R2

SEC filings parsed into constituent files and stored in TAR format. Individual documents can be downloaded using byte ranges. See [SEC Filings Archive](sec_filings_archive.md).

Usage cost:

- R2 lookups: $1 per million results returned.

### SEC Filings Websocket

Realtime SEC filing notifications via websocket. Includes one connection. See [SEC Filing Notifications](sec_filings_notifications.md#websocket).

Usage cost:

- No additional usage charge for the included connection.

### Fastest SEC Filings Websocket

SEC filing notifications that can arrive minutes earlier than other notification services. No monthly subscription is required.

Usage cost:

- $0.25 per connection per day.
- Access expires at the next 05:00 UTC reset.

## Metadata

Cost: $15/month.

Metadata datasets can be downloaded or queried using SQL. See [Datasets](datasets.md).

### SEC Filing Metadata Tables

Filing headers, associated entities, former company names, and fund series and classes extracted from SEC filings.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### SEC Submissions Details Table

Submission types, filing and report dates, detection timestamps, and XBRL availability flags.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### SEC Accession CIK Table

Links accession numbers to CIKs, identifying the companies associated with each filing.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### SEC Documents Table

Document types, sequences, filenames, descriptions, and file sizes for files within SEC filings.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### SEC Master Submissions Table

A master index of SEC submissions with filing metadata, acceptance timestamps, file numbers, and XBRL indicators.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### SEC Filer Metadata

Filer profiles with CIKs, current names, tickers, exchanges, SIC codes, and mailing and business addresses.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### SEC Filer Names

Current and former filer names with CIKs and name-history dates.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### Datamule Monitor Dumps

Records of when Datamule detected a filing, its accession number, and the detection source.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### Fastest SEC Filings Metadata

Queryable realtime filing detections with accession numbers, CIKs, submission types, detection timestamps, and detection methods.

Usage cost:

- $10 per million records returned.

## XBRL

Cost: $20/month.

### SEC XBRL

XBRL extracted from SEC filings.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

### Simple XBRL

XBRL extracted from SEC filings and flattened into columnar format. See [Datasets](datasets.md) for downloading and querying.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

## SEC XML Tables

Cost: $20/month.

### SEC XML Tables

SEC XML files converted into columnar tables. Includes institutional holdings, insider transactions, proxy voting records, Form D, and more than 110 tables. See [Datasets](datasets.md) for downloading and querying.

Usage cost:

- S3 downloads: $1/GB.
- Athena queries: $50/TB scanned.

## SEC Filings Websocket Basic

Cost: $5/month.

### SEC Filings Websocket

Realtime SEC filing notifications with up to 5 simultaneous connections. See [SEC Filing Notifications](sec_filings_notifications.md#websocket).

Usage cost:

- No additional usage charge for the included connections.

## SEC Filings Websocket Plus

Cost: $20/month.

### SEC Filings Websocket

Realtime SEC filing notifications with up to 100 simultaneous connections. See [SEC Filing Notifications](sec_filings_notifications.md#websocket).

Usage cost:

- No additional usage charge for the included connections.

## SEC Filings Email Notifications

Cost: $20/month.

### SEC Filings Email Notifications

Realtime SEC filing notifications by email. Configure your notification filters in the [dashboard](/dashboard).

Usage cost:

- No additional usage charge.

## SEC Filings Webhooks

Cost: $20/month.

### SEC Filings Webhooks

HTTPS webhooks for newly detected SEC filings. See [SEC Filing Notifications](sec_filings_notifications.md#webhooks) for adding endpoints and filtering notifications.

Usage cost:

- No additional usage charge.

