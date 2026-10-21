# Schema

Column names use the lowercase Athena names. `dtype` describes the Athena SQL type. See [Datasets](datasets.md) for querying and downloading.

Sample values illustrate each column and may come from different rows. `null` indicates a missing value in the sample. Long values are abbreviated.

## XBRL

### simple_xbrl

XBRL facts flattened into rows. Requires an XBRL subscription.

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `91946513000010` |
| `filingdate` | `varchar` | `"2013-02-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/simple_xbrl/2013-02-05/000091946513000010.parquet"` |
| `context_id` | `bigint` | `128` |
| `decimals` | `varchar` | `"-6"` |
| `dimensions` | `array(row(dimension varchar, type varchar, value varchar))` | `[{"dimension": "us-gaap:StatementEquityComponentsAxis", "type": "explicit", "value": "cik0000919465:NotesReceivableCommonStockMember"}]` |
| `members` | `varchar` | `"cik0000919465:NotesReceivableCommonStockMember"` |
| `name` | `varchar` | `"StockholdersEquity"` |
| `period_end_date` | `varchar` | `null` |
| `period_start_date` | `varchar` | `"2011-10-01"` |
| `precision` | `varchar` | `null` |
| `taxonomy` | `varchar` | `"us-gaap"` |
| `unit` | `varchar` | `"USD"` |
| `value` | `varchar` | `"-2000000"` |

`taxonomy` and `name` identify the fact, for example `us-gaap` and `Revenues`. Tags can differ between companies and reporting periods. `value` can contain numeric or text facts; use `TRY_CAST(value AS DOUBLE)` for numeric analysis and inspect `unit`.

`dimensions` records the fact's dimensions and members, such as business segments or geography. Each entry has `dimension`, `type`, and `value` fields. `members` is a legacy field; use `dimensions`.

For consolidated totals, select undimensioned facts with `dimensions IS NULL OR CARDINALITY(dimensions) = 0`. Checking only for `NULL` excludes facts whose dimensions are an empty array. Apply this scope filter before deduplicating disclosures.

Join on `accessionnumber` to `sec_accession_cik_table` for CIKs and `sec_submission_details_table` for filing types and report dates. This table has no CIK or ticker column. Use `filer_metadata` to resolve a ticker to a CIK.

Use `period_start_date` and `period_end_date` to identify the reported period. A company's fiscal year need not match the calendar year. `filingdate` is when the filing was filed, not the end of the fact's reporting period.

Period strings can include a time suffix. For date calculations, use `TRY_CAST(SUBSTR(period_start_date, 1, 10) AS DATE)` and the equivalent for `period_end_date`. Athena durations use `date_diff('day', start_date, end_date)`; subtracting dates produces an interval, not an integer day count.

Facts are reported as filed. The same period can appear in multiple filings, including amendments and comparative disclosures. Choose the appropriate fact, unit, dimensions, and period, then deduplicate disclosures before constructing a time series. Summing or averaging repeated disclosures can double-count revenue.

#### Example

Discover Apple's reported revenue tags and contexts:

```sql
SELECT
    x.accessionnumber,
    s.submissiontype,
    x.filingdate,
    x.taxonomy,
    x.name,
    x.period_start_date,
    x.period_end_date,
    x.unit,
    TRY_CAST(x.value AS DOUBLE) AS value,
    x.dimensions
FROM simple_xbrl x
JOIN sec_submission_details_table s
  ON x.accessionnumber = s.accessionnumber
WHERE x.accessionnumber IN (
    SELECT accessionnumber
    FROM sec_accession_cik_table
    WHERE cik = 320193
      AND filingdate >= '2020-01-01'
)
  AND x.filingdate >= '2020-01-01'
  AND s.submissiontype IN ('10-K', '10-K/A')
  AND x.taxonomy = 'us-gaap'
  AND LOWER(x.name) LIKE '%revenue%'
ORDER BY x.period_end_date DESC, x.filingdate DESC
LIMIT 100
```

Inspect the returned tags, units, periods, and dimensions before choosing a consolidated annual revenue series. The result is a sample of reported facts.

## Metadata

These tables require a Metadata subscription.

### filer_metadata

SEC filer profiles, including current names, ticker symbols, exchanges, industry codes, and addresses. Includes companies and individuals without tickers.

| Column | dtype | Sample value |
|---|---|---|
| `cik` | `bigint` | `40211` |
| `name` | `varchar` | `"GATX CORP"` |
| `entitytype` | `varchar` | `"operating"` |
| `sic` | `varchar` | `"4700"` |
| `sicdescription` | `varchar` | `"Transportation Services"` |
| `ownerorg` | `varchar` | `"01 Energy & Transportation"` |
| `ein` | `varchar` | `"361124040"` |
| `description` | `varchar` | `""` |
| `category` | `varchar` | `"Large accelerated filer"` |
| `fiscalyearend` | `varchar` | `"1231"` |
| `stateofincorporation` | `varchar` | `"NY"` |
| `stateofincorporationdescription` | `varchar` | `"NY"` |
| `phone` | `varchar` | `"3126216200"` |
| `flags` | `varchar` | `""` |
| `mailing_street1` | `varchar` | `"233 SOUTH WACKER DRIVE"` |
| `mailing_street2` | `varchar` | `"# 3201"` |
| `mailing_city` | `varchar` | `"CHICAGO"` |
| `mailing_stateorcountry` | `varchar` | `"IL"` |
| `mailing_zipcode` | `varchar` | `"60606-7147"` |
| `mailing_stateorcountrydescription` | `varchar` | `"IL"` |
| `business_street1` | `varchar` | `"233 SOUTH WACKER DRIVE"` |
| `business_street2` | `varchar` | `"SUITE 1010"` |
| `business_city` | `varchar` | `"CHICAGO"` |
| `business_stateorcountry` | `varchar` | `"IL"` |
| `business_zipcode` | `varchar` | `"60606-7147"` |
| `business_stateorcountrydescription` | `varchar` | `"IL"` |
| `start_date` | `varchar` | `"1994-02-14"` |
| `tickers` | `array(varchar)` | `["GATX"]` |
| `exchanges` | `array(varchar)` | `["NYSE"]` |
| `insidertransactionforownerexists` | `bigint` | `0` |
| `insidertransactionforissuerexists` | `bigint` | `1` |

`cik` is numeric, without leading-zero padding. `tickers` and `exchanges` are arrays, not scalar strings. Missing values can be null.

Resolve a ticker before looking up its filings:

```sql
SELECT cik, name, tickers
FROM filer_metadata
WHERE CONTAINS(tickers, 'AAPL')
LIMIT 10
```

### sec_accession_cik_table

CIKs associated with each filing. A filing can have more than one associated CIK. Use this table to find a company's filings or connect filing-level data to filer profiles.

| Column | dtype | Sample value |
|---|---|---|
| `filingdate` | `varchar` | `"2022-01-25"` |
| `accessionnumber` | `decimal(20,0)` | `22000936` |
| `cik` | `decimal(20,0)` | `1668010` |

`accessionnumber` and `cik` are numeric, without dashes or leading-zero padding. For example, Apple's CIK is `320193`. Join `accessionnumber` to `simple_xbrl.accessionnumber` or `sec_submission_details_table.accessionnumber`, and `cik` to `filer_metadata.cik`.

When filtering facts for one company, an `IN` subquery on `accessionnumber` avoids duplicating fact rows because a filing has multiple associated CIKs.

### sec_submission_details_table

Filing types, filing and report dates, detection timestamps, and XBRL availability flags. Join to other filing-level tables on `accessionnumber`.

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `decimal(20,0)` | `93101712000007` |
| `submissiontype` | `varchar` | `"4"` |
| `filingdate` | `varchar` | `"2012-05-21"` |
| `reportdate` | `varchar` | `"2012-05-17"` |
| `detectedtime` | `timestamp(3)` | `null` |
| `containsxbrl` | `integer` | `0` |

`submissiontype` contains forms such as `10-K`, `10-K/A`, and `10-Q`. `filingdate` and `reportdate` are date strings. `detectedtime` is a UTC timestamp, not a Unix timestamp number. Detection time, filing date, and report date describe different events.

## XML Tables

### 1_k

document_types: `1-K`, `1-K/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114420416096460` |
| `filingdate` | `varchar` | `"2016-04-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-04-27/1-K/000114420416096460.parquet"` |
| `_table` | `varchar` | `"1-K"` |
| `city` | `varchar` | `"WASHINGTON"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `filenumber` | `varchar` | `"24R-00009"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001645583"` |
| `fiscalyearend` | `varchar` | `"12-31-2015"` |
| `formindication` | `varchar` | `"Annual Report"` |
| `issuedsecuritiestitle` | `varchar` | `"Common Shares"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `phonenumber` | `varchar` | `"202-584-0550"` |
| `regarule257` | `varchar` | `"false"` |
| `reportingperiod` | `varchar` | `"12-31-2015"` |
| `returncopyflag` | `varchar` | `"false"` |
| `shellcompanyflag` | `varchar` | `"N"` |
| `stateorcountry` | `varchar` | `"DC"` |
| `street1` | `varchar` | `"1519 CONNECTICUT AVENUE NW"` |
| `street2` | `varchar` | `"SUITE 200"` |
| `submissiontype` | `varchar` | `"1-K"` |
| `successorfilingflag` | `varchar` | `"N"` |
| `zipcode` | `varchar` | `"20036"` |

### 1_z

document_types: `1-Z`, `1-Z/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `161721615000020` |
| `filingdate` | `varchar` | `"2015-11-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-11-02/1-z/000161721615000020.parquet"` |
| `_table` | `varchar` | `"1-z"` |
| `approxrecordholders` | `varchar` | `"38"` |
| `auditorfees` | `varchar` | `"25000.00"` |
| `auditorspname` | `varchar` | `"Stovall\|Grandey & Allen L.L.P."` |
| `blueskyfees` | `varchar` | `"0.00"` |
| `blueskyspname` | `varchar` | `"None"` |
| `certificationfilenumber` | `varchar` | `"024-10437"` |
| `city` | `varchar` | `"Bayside"` |
| `clarificationresponses` | `varchar` | `"Offering terminated on October 14, 2015"` |
| `commissionfilenumber` | `varchar` | `"024-10437"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `crdnumberbrokerdealer` | `varchar` | `null` |
| `filenumber` | `varchar` | `"24R-00003"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001617216"` |
| `findersfees` | `varchar` | `"0.00"` |
| `findersspname` | `varchar` | `"None"` |
| `issuername` | `varchar` | `"Lemont Inc"` |
| `issuernetproceeds` | `varchar` | `"31006.00"` |
| `legalfees` | `varchar` | `"5000.00"` |
| `legalspname` | `varchar` | `"Law Office of Gang Zhou\|ESQ"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `offeringcommencedate` | `varchar` | `"06-17-2015"` |
| `offeringqualificationdate` | `varchar` | `"06-16-2015"` |
| `offeringsecuritiesqualifiedsold` | `varchar` | `"380000000"` |
| `offeringsecuritiessold` | `varchar` | `"380000000"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `phone` | `varchar` | `"6465086285"` |
| `portionsecuritiessoldissuer` | `varchar` | `"38000.00"` |
| `portionsecuritiessoldsecurityholders` | `varchar` | `"0.00"` |
| `pricepersecurity` | `varchar` | `"0.00"` |
| `promoterspname` | `varchar` | `"None"` |
| `promotersfees` | `varchar` | `"0.00"` |
| `returncopyflag` | `varchar` | `"true"` |
| `salescommissionsfee` | `varchar` | `"0.00"` |
| `salescommissionsspname` | `varchar` | `"None"` |
| `securitiesclasstitle` | `varchar` | `"Class A common share"` |
| `stateorcountry` | `varchar` | `"NY"` |
| `street1` | `varchar` | `"6112 228th street"` |
| `street2` | `varchar` | `"Suite 214"` |
| `submissiontype` | `varchar` | `"1-Z"` |
| `successorfilingflag` | `varchar` | `"N"` |
| `underwriterfees` | `varchar` | `"0.00"` |
| `underwrittenspname` | `varchar` | `"None"` |
| `zipcode` | `varchar` | `"11364"` |

### 13fhr

document_types: `13F-HR`, `13F-HR/A`, `13F-NT`, `13F-NT/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95012313003669` |
| `filingdate` | `varchar` | `"2013-05-20"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2013-05-20/13fhr/000095012313003669.parquet"` |
| `_table` | `varchar` | `"13fhr"` |
| `additionalinformation` | `varchar` | `null` |
| `amendmentno` | `varchar` | `"1"` |
| `amendmenttype` | `varchar` | `"RESTATEMENT"` |
| `city` | `varchar` | `"BRYN MAWR"` |
| `confdeniedexpired` | `varchar` | `null` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `crdnumber` | `varchar` | `null` |
| `datedeniedexpired` | `varchar` | `null` |
| `datereported` | `varchar` | `null` |
| `denovorequest` | `varchar` | `null` |
| `filenumber` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0000900974"` |
| `filingmanagername` | `varchar` | `"BRYN MAWR TRUST CO/PA"` |
| `form13ffilenumber` | `varchar` | `"028-03674"` |
| `isamendment` | `varchar` | `"true"` |
| `isconfidentialomitted` | `varchar` | `"false"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `otherincludedmanagerscount` | `varchar` | `"0"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `periodofreport` | `varchar` | `"03-31-2013"` |
| `provideinfoforinstruction5` | `varchar` | `"N"` |
| `reasonfornonconfidentiality` | `varchar` | `null` |
| `reportcalendarorquarter` | `varchar` | `"03-31-2013"` |
| `reporttype` | `varchar` | `"13F HOLDINGS REPORT"` |
| `returncopyflag` | `varchar` | `"true"` |
| `schemaversion` | `varchar` | `null` |
| `secfilenumber` | `varchar` | `null` |
| `signature` | `varchar` | `"/s/ Marie D Connolly"` |
| `signaturecity` | `varchar` | `"BRYN MAWR"` |
| `signaturedate` | `varchar` | `"05-14-2013"` |
| `signaturename` | `varchar` | `"Marie D Connolly"` |
| `signaturephone` | `varchar` | `"610-581-4899"` |
| `signaturestateorcountry` | `varchar` | `"PA"` |
| `signaturetitle` | `varchar` | `"SVP"` |
| `stateorcountry` | `varchar` | `"PA"` |
| `street1` | `varchar` | `"801 LANCASTER AVENUE"` |
| `street2` | `varchar` | `"SUITE 1750"` |
| `submissiontype` | `varchar` | `"13F-HR"` |
| `tableentrytotal` | `varchar` | `"788"` |
| `tablevaluetotal` | `varchar` | `"1549941"` |
| `zipcode` | `varchar` | `"19010-3396"` |

### 13fhr_other_manager

document_types: `13F-HR`, `13F-HR/A`, `13F-NT`, `13F-NT/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114420413030750` |
| `filingdate` | `varchar` | `"2013-05-21"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2013-05-21/13fhr_other_manager/000114420413030750.parquet"` |
| `_table` | `varchar` | `"13fhr_other_manager"` |
| `cik` | `varchar` | `"0000019617"` |
| `crdnumber` | `varchar` | `null` |
| `form13ffilenumber` | `varchar` | `"028-00694"` |
| `name` | `varchar` | `"JPMORGAN CHASE & CO"` |
| `secfilenumber` | `varchar` | `null` |

### 13fhr_other_manager2

document_types: `13F-HR`, `13F-HR/A`, `13F-NT`, `13F-NT/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `108514613001007` |
| `filingdate` | `varchar` | `"2013-05-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2013-05-22/13fhr_other_manager2/000108514613001007.parquet"` |
| `_table` | `varchar` | `"13fhr_other_manager2"` |
| `cik` | `varchar` | `null` |
| `crdnumber` | `varchar` | `null` |
| `form13ffilenumber` | `varchar` | `null` |
| `name` | `varchar` | `"HSBC BANK USA, N.A."` |
| `secfilenumber` | `varchar` | `null` |
| `sequencenumber` | `varchar` | `"1"` |

### 1a

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a"` |
| `accountspayable` | `varchar` | `"0.00"` |
| `accountsreceivable` | `varchar` | `"0.00"` |
| `auditorfees` | `varchar` | `"5000.00"` |
| `auditorserviceprovidername` | `varchar` | `"Clifton Larson Allen"` |
| `blueskyfees` | `varchar` | `"0.00"` |
| `blueskyserviceprovidername` | `varchar` | `"N/A"` |
| `brokerdealercrdnumber` | `varchar` | `"0"` |
| `cashequivalents` | `varchar` | `"50000.00"` |
| `certifyifbadactor` | `varchar` | `"false"` |
| `certifyifnotdisqualified` | `varchar` | `"true"` |
| `certifyiftrue` | `varchar` | `"true"` |
| `city` | `varchar` | `"Orlando"` |
| `clarificationresponses` | `varchar` | `null` |
| `concurrentofferingaggregate` | `varchar` | `"0.00"` |
| `connectionname` | `varchar` | `"Myra Nicholson"` |
| `costandexpensesappltorevenues` | `varchar` | `"0.00"` |
| `deposits` | `varchar` | `null` |
| `depreciationandamortization` | `varchar` | `"0.00"` |
| `earningspersharebasic` | `varchar` | `"0.00"` |
| `earningspersharediluted` | `varchar` | `"0.00"` |
| `estimatednetamount` | `varchar` | `"0.00"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001645471"` |
| `financialstatementauditstatus` | `varchar` | `"Audited"` |
| `finderfeesfee` | `varchar` | `"0.00"` |
| `findersfeesserviceprovidername` | `varchar` | `"0"` |
| `ifunregisterednone` | `varchar` | `"false"` |
| `indicatetier1tier2offering` | `varchar` | `"Tier2"` |
| `industrygroup` | `varchar` | `"Other"` |
| `investmentsecurities` | `varchar` | `"0.00"` |
| `issueraggregateoffering` | `varchar` | `"50000000.00"` |
| `jurisdictionsofsecofferednone` | `varchar` | `"true"` |
| `jurisdictionsofsecofferedsame` | `varchar` | `"false"` |
| `legalfees` | `varchar` | `"20000.00"` |
| `legalserviceprovidername` | `varchar` | `"PinoNicholson PLLC"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `loans` | `varchar` | `null` |
| `longtermdebt` | `varchar` | `"0.00"` |
| `nameauditor` | `varchar` | `"Clifton Larson Allen"` |
| `netincome` | `varchar` | `"0.00"` |
| `offerdelayedcontinuousflag` | `varchar` | `"N"` |
| `offeringafterqualifflag` | `varchar` | `"N"` |
| `offeringbesteffortsflag` | `varchar` | `"Y"` |
| `offeringfilenumber` | `varchar` | `"024-10459"` |
| `offeringyearflag` | `varchar` | `"Y"` |
| `outstandingsecurities` | `varchar` | `"0"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `phonenumber` | `varchar` | `"407-331-8004"` |
| `policyliabilitiesandaccruals` | `varchar` | `null` |
| `pricepersecurity` | `varchar` | `"5000.00"` |
| `promotersfees` | `varchar` | `"0.00"` |
| `promotersserviceprovidername` | `varchar` | `null` |
| `propertyandequipment` | `varchar` | `null` |
| `propertyplantequipment` | `varchar` | `"0.00"` |
| `qualificationofferingaggregate` | `varchar` | `"0.00"` |
| `resalesecuritiesaffiliatesflag` | `varchar` | `"N"` |
| `returncopyflag` | `varchar` | `"true"` |
| `salescommissionsserviceproviderfees` | `varchar` | `"0.00"` |
| `salescommissionsserviceprovidername` | `varchar` | `"0"` |
| `securitiesactexemption` | `varchar` | `"The sales were made pursuant to Regulation D, rule 506. The Form D was filed with regards to each entity."` |
| `securitiesoffered` | `varchar` | `"10000"` |
| `securitiesofferedotherdesc` | `varchar` | `null` |
| `securityholderaggregate` | `varchar` | `"0.00"` |
| `sincelastfiling` | `varchar` | `"true"` |
| `solicitationproposedofferingflag` | `varchar` | `"N"` |
| `stateorcountry` | `varchar` | `"FL"` |
| `street1` | `varchar` | `"189 South Orange Avenue, Suite 1650"` |
| `street2` | `varchar` | `"10TH FLOOR"` |
| `submissiontype` | `varchar` | `"1-A"` |
| `totalaggregateoffering` | `varchar` | `"50000000.00"` |
| `totalassets` | `varchar` | `"50000.00"` |
| `totalinterestexpenses` | `varchar` | `null` |
| `totalinterestincome` | `varchar` | `null` |
| `totalinvestments` | `varchar` | `null` |
| `totalliabilities` | `varchar` | `"0.00"` |
| `totalliabilitiesandequity` | `varchar` | `"50000.00"` |
| `totalrevenues` | `varchar` | `"0.00"` |
| `totalstockholderequity` | `varchar` | `"50000.00"` |
| `underwritersfees` | `varchar` | `"0.00"` |
| `underwritersserviceprovidername` | `varchar` | `null` |
| `zipcode` | `varchar` | `"32801"` |

### 1a_co_filer

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `161592315000004` |
| `filingdate` | `varchar` | `"2015-10-14"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-10-14/1a_co_filer/000161592315000004.parquet"` |
| `_table` | `varchar` | `"1a_co_filer"` |
| `coissuerccc` | `varchar` | `"XXXXXXXX"` |
| `coissuercik` | `varchar` | `null` |
| `coissuerfilenumber` | `varchar` | `null` |

### 1a_common_equity

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_common_equity/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_common_equity"` |
| `commoncusipequity` | `varchar` | `"0"` |
| `commonequityclassname` | `varchar` | `"0"` |
| `outstandingcommonequity` | `varchar` | `"0"` |
| `publiclytradedcommonequity` | `varchar` | `"0"` |

### 1a_dealers_jurisdiction

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `158799915000003` |
| `filingdate` | `varchar` | `"2015-06-23"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-23/1a_dealers_jurisdiction/000158799915000003.parquet"` |
| `_table` | `varchar` | `"1a_dealers_jurisdiction"` |
| `dealersjurisdiction` | `varchar` | `"DC"` |

### 1a_debt_securities

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_debt_securities/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_debt_securities"` |
| `cusipdebtsecurities` | `varchar` | `"0"` |
| `debtsecuritiesclassname` | `varchar` | `"0"` |
| `outstandingdebtsecurities` | `varchar` | `"0"` |
| `publiclytradeddebtsecurities` | `varchar` | `"0"` |

### 1a_employees_info

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_employees_info/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_employees_info"` |
| `fulltimeemployees` | `varchar` | `"0"` |
| `irsnum` | `varchar` | `"30-0874037"` |
| `issuercik` | `varchar` | `"0001645471"` |
| `issuername` | `varchar` | `"Tuscan Gardens Secured Income Fund LLC"` |
| `jurisdictionorganization` | `varchar` | `"FL"` |
| `parttimeemployees` | `varchar` | `"0"` |
| `siccode` | `varchar` | `"6500"` |
| `yearincorporation` | `varchar` | `"2015"` |

### 1a_issue_jurisdiction

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_issue_jurisdiction/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_issue_jurisdiction"` |
| `issuejurisdiction` | `varchar` | `"FL"` |

### 1a_preferred_equity

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_preferred_equity/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_preferred_equity"` |
| `outstandingpreferredequity` | `varchar` | `"0"` |
| `preferredcusipequity` | `varchar` | `"0"` |
| `preferredequityclassname` | `varchar` | `"0"` |
| `publiclytradedpreferredequity` | `varchar` | `"0"` |

### 1a_securities_issued

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_securities_issued/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_securities_issued"` |
| `aggregateconsiderationbasis` | `varchar` | `"The Common Unit issued to IAMC was issued upon formation of the Partnership (and as noted above will be cancelled upon the sale of the minimum amount of Common Units in this Offering) for no consi...` |
| `securitiesissuedaggregateamount` | `varchar` | `"Each unit sold for $10,000 with a minimum purchase of 5 units."` |
| `securitiesissuedtotalamount` | `varchar` | `"2875000"` |
| `securitiesissuername` | `varchar` | `"Tuscan Gardens Income Fund LLC"` |
| `securitiesissuertitle` | `varchar` | `"Preferred Membership Interest"` |
| `securitiesprincipalholderamount` | `varchar` | `"0"` |

### 1a_securities_offered_types

document_types: `1-A`, `1-A POS`, `1-A/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164547115000001` |
| `filingdate` | `varchar` | `"2015-06-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-22/1a_securities_offered_types/000164547115000001.parquet"` |
| `_table` | `varchar` | `"1a_securities_offered_types"` |
| `securitiesofferedtypes` | `varchar` | `"Equity (common or preferred stock)"` |

### 1k_item1_info

document_types: `1-K`, `1-K/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114420416096460` |
| `filingdate` | `varchar` | `"2016-04-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-04-27/1k_item1_info/000114420416096460.parquet"` |
| `_table` | `varchar` | `"1k_item1_info"` |
| `irsnum` | `varchar` | `"32-0467957"` |
| `issuercik` | `varchar` | `"0001645583"` |
| `issuername` | `varchar` | `"Fundrise Real Estate Investment Trust, LLC"` |
| `jurisdictionorganization` | `varchar` | `"DE"` |

### 1k_summary_info

document_types: `1-K`, `1-K/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `121465916011078` |
| `filingdate` | `varchar` | `"2016-04-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-04-29/1k_summary_info/000121465916011078.parquet"` |
| `_table` | `varchar` | `"1k_summary_info"` |
| `aggregrateofferingprice` | `varchar` | `"16920576.00"` |
| `aggregrateofferingpriceholders` | `varchar` | `"0.00"` |
| `auditorfees` | `varchar` | `"15000.00"` |
| `auditorspname` | `varchar` | `"EKS&H"` |
| `blueskyfees` | `varchar` | `"30000.00"` |
| `blueskyspname` | `varchar` | `"Dill Dill Carr Stonbraker & Hutchings, P.C."` |
| `clarificationresponses` | `varchar` | `"The above table does not include fees paid to FundAmerica Securities LLC for administrative and escrow agent services, FINRA filing fee, fees for EDGAR document conversion and filing, and website ...` |
| `commissionfilenumber` | `varchar` | `"024-10473"` |
| `crdnumberbrokerdealer` | `varchar` | `"170937"` |
| `findersfees` | `varchar` | `"0.00"` |
| `findersspname` | `varchar` | `"N/A"` |
| `issuernetproceeds` | `varchar` | `"16750576.00"` |
| `legalfees` | `varchar` | `"140000.00"` |
| `legalspname` | `varchar` | `"Dill Dill Carr Stonbraker & Hutchings, P.C."` |
| `offeringcommencedate` | `varchar` | `"11-20-2015"` |
| `offeringqualificationdate` | `varchar` | `"11-20-2015"` |
| `offeringsecuritiessold` | `varchar` | `"16920576"` |
| `pricepersecurity` | `varchar` | `"12.00"` |
| `promoterspname` | `varchar` | `"N/A"` |
| `promotersfees` | `varchar` | `"0.00"` |
| `qualifiedsecuritiessold` | `varchar` | `"30096000"` |
| `salescommissionsfee` | `varchar` | `"1125000.00"` |
| `salescommissionsspname` | `varchar` | `"SI Securities LLC"` |
| `underwriterfees` | `varchar` | `"0.00"` |
| `underwrittenspname` | `varchar` | `"N/A"` |

### 1z_signature_tab

document_types: `1-Z`, `1-Z/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `161721615000020` |
| `filingdate` | `varchar` | `"2015-11-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-11-02/1z_signature_tab/000161721615000020.parquet"` |
| `_table` | `varchar` | `"1z_signature_tab"` |
| `regulationissuername1` | `varchar` | `"Lemont Inc"` |
| `regulationissuername2` | `varchar` | `"Lemont Inc"` |
| `signatureby` | `varchar` | `"Wanjun Xie"` |
| `signaturecik` | `varchar` | `"0001617216"` |
| `signaturedate` | `varchar` | `"11-02-2015"` |
| `signaturetitle` | `varchar` | `"President"` |

### 24f2nt

document_types: `24F-2NT`, `24F-2NT/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `100475622000004` |
| `filingdate` | `varchar` | `"2022-02-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-02-01/24f2nt/000100475622000004.parquet"` |
| `_table` | `varchar` | `"24f2nt"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `filenumber` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0000792394"` |
| `investmentcompanytype` | `varchar` | `"N-1A"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `schemaversion` | `varchar` | `"X0101"` |
| `submissiontype` | `varchar` | `"24F-2NT"` |

### 24f2nt_annual_filing_info

document_types: `24F-2NT`, `24F-2NT/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `100475622000004` |
| `filingdate` | `varchar` | `"2022-02-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-02-01/24f2nt_annual_filing_info/000100475622000004.parquet"` |
| `_table` | `varchar` | `"24f2nt_annual_filing_info"` |
| `aggregateredeemedanyprior` | `varchar` | `"5981505.00"` |
| `aggregateredeemedinfiscalyear` | `varchar` | `"2052579.00"` |
| `aggregatesaleprice` | `varchar` | `"975711.00"` |
| `annualclassid` | `varchar` | `null` |
| `annualclassname` | `varchar` | `null` |
| `annualclassnameinfoclassname` | `varchar` | `null` |
| `city` | `varchar` | `"Pearl River"` |
| `classid` | `varchar` | `"C000000265"` |
| `classname` | `varchar` | `"Wealth Shares"` |
| `country` | `varchar` | `"X1"` |
| `feemultiplier` | `varchar` | `"0.0000927"` |
| `includeallclassesflag` | `varchar` | `"true"` |
| `investmentcompactfileno` | `varchar` | `"811-04643"` |
| `isfiledlate` | `varchar` | `"false"` |
| `islastfiling` | `varchar` | `"true"` |
| `issuername` | `varchar` | `"VOLUMETRIC FUND INC"` |
| `item6interestdue` | `varchar` | `null` |
| `item7interestdue` | `varchar` | `"0.00"` |
| `item7totalfeeplusinterest` | `varchar` | `null` |
| `item8explanatorynotes` | `varchar` | `null` |
| `item8totalfeeplusinterest` | `varchar` | `"0.00"` |
| `item9explanatorynotes` | `varchar` | `null` |
| `lastdayoffiscalyear` | `varchar` | `"12/31/2021"` |
| `netsales` | `varchar` | `"0.00"` |
| `redemptioncreditsavailable` | `varchar` | `"(7058373.00)"` |
| `registrationfeedue` | `varchar` | `"0.00"` |
| `rptincludeallclassesflag` | `varchar` | `null` |
| `rptincludeallflag` | `varchar` | `null` |
| `rptincludeallseriesflag` | `varchar` | `"true"` |
| `securitiesactfileno` | `varchar` | `"033-12703"` |
| `securitiesdeducted` | `varchar` | `"0.00"` |
| `seriesid` | `varchar` | `"S000000306"` |
| `seriesname` | `varchar` | `"General Treasury and Agency Money Market Fund"` |
| `seriesorclassid` | `varchar` | `"S000000306"` |
| `sharesremainingunsold` | `varchar` | `"0.00"` |
| `signature` | `varchar` | `"Jeffrey Gibs"` |
| `signaturedate` | `varchar` | `"02/01/2022"` |
| `signaturenameandtitle` | `varchar` | `"Jeffrey Gibs, President"` |
| `state` | `varchar` | `"NY"` |
| `street1` | `varchar` | `"87 Violet Drive"` |
| `street2` | `varchar` | `null` |
| `totalredemptioncredits` | `varchar` | `"8034084.00"` |
| `zipcode` | `varchar` | `"10965"` |

### 25_nse

document_types: `25-NSE`, `25-NSE/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114331306000023` |
| `filingdate` | `varchar` | `"2006-05-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2006-05-01/25-NSE/000114331306000023.parquet"` |
| `_table` | `varchar` | `"25-NSE"` |
| `city` | `varchar` | `"ANN ARBOR"` |
| `descriptionclasssecurity` | `varchar` | `"Common Stock, Par Value $.01"` |
| `exchangecik` | `varchar` | `"0001143313"` |
| `exchangeentityname` | `varchar` | `"AMERICAN STOCK EXCHANGE LLC"` |
| `issuercik` | `varchar` | `"0001037652"` |
| `issuerentityname` | `varchar` | `"PELICAN FINANCIAL INC"` |
| `issuerfilenumber` | `varchar` | `"001-14986"` |
| `issuertelephonenumber` | `varchar` | `"7346629733"` |
| `ruleprovision` | `varchar` | `"17 CFR 240.12d2-2(a)(3)"` |
| `schemaversion` | `varchar` | `"X0202"` |
| `signaturedate` | `varchar` | `"2006-05-01"` |
| `signaturename` | `varchar` | `"Kerri Ramirez"` |
| `signaturetitle` | `varchar` | `"Manager, Corporate Actions and Proxy Rulings"` |
| `stateorcountry` | `varchar` | `"MICHIGAN"` |
| `stateorcountrycode` | `varchar` | `"MI"` |
| `street1` | `varchar` | `"315 EAST EISENHOWER"` |
| `street2` | `varchar` | `"38TH FLOOR"` |
| `zipcode` | `varchar` | `"48108"` |

### 345

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `154304716000026` |
| `filingdate` | `varchar` | `"2016-08-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-08-02/345/000154304716000026.parquet"` |
| `_table` | `varchar` | `"345"` |
| `aff10b5one` | `varchar` | `null` |
| `dateoforiginalsubmission` | `varchar` | `null` |
| `documenttype` | `varchar` | `"4"` |
| `form3holdingsreported` | `varchar` | `null` |
| `form4transactionsreported` | `varchar` | `null` |
| `issuercik` | `varchar` | `"0001370946"` |
| `issuerforeigntradingsymbol` | `varchar` | `null` |
| `issuername` | `varchar` | `"Owens Corning"` |
| `issuertradingsymbol` | `varchar` | `"OC"` |
| `nosecuritiesowned` | `varchar` | `"0"` |
| `notsubjecttosection16` | `varchar` | `"1"` |
| `periodofreport` | `varchar` | `"2016-07-29"` |
| `remarks` | `varchar` | `null` |
| `rptownercountry` | `varchar` | `null` |
| `rptownernonusaddressflag` | `varchar` | `null` |
| `rptownernonusstateterritory` | `varchar` | `null` |
| `schemaversion` | `varchar` | `"X0306"` |

### 345_derivative_holding

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `8281103000015` |
| `filingdate` | `varchar` | `"2003-07-28"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2003-07-28/345_derivative_holding/000008281103000015.parquet"` |
| `_table` | `varchar` | `"345_derivative_holding"` |
| `directorindirectownershipfootnoteidid` | `varchar` | `null` |
| `directorindirectownershipvalue` | `varchar` | `"D"` |
| `exercisedatevalue` | `varchar` | `"2003-07-18"` |
| `expirationdatefootnoteidid` | `varchar` | `null` |
| `expirationdatevalue` | `varchar` | `"2013-07-18"` |
| `footnoteidid` | `varchar` | `null` |
| `id` | `varchar` | `null` |
| `natureofownershipfootnoteidid` | `varchar` | `null` |
| `natureofownershipvalue` | `varchar` | `null` |
| `securitytitlefootnoteidid` | `varchar` | `"F1"` |
| `securitytitlevalue` | `varchar` | `"Options"` |
| `sharesownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `sharesownedfollowingtransactionvalue` | `varchar` | `null` |
| `transactioncodingfootnoteidid` | `varchar` | `null` |
| `transactionformtype` | `varchar` | `null` |
| `underlyingsecuritysharesfootnoteidid` | `varchar` | `null` |
| `underlyingsecuritysharesvalue` | `varchar` | `"3000"` |
| `underlyingsecuritytitlefootnoteidid` | `varchar` | `null` |
| `underlyingsecuritytitlevalue` | `varchar` | `"Common Stock"` |
| `underlyingsecurityvaluefootnoteidid` | `varchar` | `null` |
| `underlyingsecurityvaluevalue` | `varchar` | `null` |
| `value` | `varchar` | `"19.95"` |
| `valueownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `valueownedfollowingtransactionvalue` | `varchar` | `null` |

### 345_derivative_security

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `497703000117` |
| `filingdate` | `varchar` | `"2003-05-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2003-05-05/345_derivative_security/000000497703000117.parquet"` |
| `_table` | `varchar` | `"345_derivative_security"` |
| `deemedexecutiondatevalue` | `varchar` | `null` |
| `directorindirectownershipfootnoteidid` | `varchar` | `null` |
| `directorindirectownershipvalue` | `varchar` | `"D"` |
| `equityswapinvolved` | `varchar` | `"0"` |
| `exercisedatefootnoteidid` | `varchar` | `"F1"` |
| `exercisedatevalue` | `varchar` | `"1993-06-28"` |
| `expirationdatefootnoteidid` | `varchar` | `null` |
| `expirationdatevalue` | `varchar` | `"2003-06-28"` |
| `footnoteidid` | `varchar` | `null` |
| `id` | `varchar` | `null` |
| `natureofownershipfootnoteidid` | `varchar` | `null` |
| `natureofownershipvalue` | `varchar` | `null` |
| `securitytitlefootnoteidid` | `varchar` | `null` |
| `securitytitlevalue` | `varchar` | `"Employee Stock Option (Right to buy)"` |
| `sharesownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `sharesownedfollowingtransactionvalue` | `varchar` | `"0"` |
| `transactionacquireddisposedcodefootnoteidid` | `varchar` | `null` |
| `transactionacquireddisposedcodevalue` | `varchar` | `"D"` |
| `transactioncode` | `varchar` | `"M"` |
| `transactioncodingfootnoteidid` | `varchar` | `null` |
| `transactiondatefootnoteidid` | `varchar` | `null` |
| `transactiondatevalue` | `varchar` | `"2003-05-01"` |
| `transactionformtype` | `varchar` | `"4"` |
| `transactionsharesfootnoteidid` | `varchar` | `null` |
| `transactionsharesvalue` | `varchar` | `"2669"` |
| `transactiontimelinessvalue` | `varchar` | `null` |
| `transactionvaluefootnoteidid` | `varchar` | `null` |
| `transactionvaluevalue` | `varchar` | `"4.7084"` |
| `underlyingsecuritysharesfootnoteidid` | `varchar` | `null` |
| `underlyingsecuritysharesvalue` | `varchar` | `"2669"` |
| `underlyingsecuritytitlefootnoteidid` | `varchar` | `null` |
| `underlyingsecuritytitlevalue` | `varchar` | `"Common Stock"` |
| `underlyingsecurityvaluevalue` | `varchar` | `null` |
| `value` | `varchar` | `"4.7084"` |
| `valueownedfollowingtransactionvalue` | `varchar` | `null` |

### 345_derivative_transaction

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `124891516000244` |
| `filingdate` | `varchar` | `"2016-11-14"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-11-14/345_derivative_transaction/000124891516000244.parquet"` |
| `_table` | `varchar` | `"345_derivative_transaction"` |
| `deemedexecutiondatevalue` | `varchar` | `null` |
| `directorindirectownershipfootnoteidid` | `varchar` | `null` |
| `directorindirectownershipvalue` | `varchar` | `"D"` |
| `equityswapinvolved` | `varchar` | `"0"` |
| `exercisedatefootnoteidid` | `varchar` | `"F1"` |
| `exercisedatevalue` | `varchar` | `null` |
| `expirationdatefootnoteidid` | `varchar` | `"F2"` |
| `expirationdatevalue` | `varchar` | `null` |
| `footnoteidid` | `varchar` | `null` |
| `id` | `varchar` | `null` |
| `natureofownershipfootnoteidid` | `varchar` | `null` |
| `natureofownershipvalue` | `varchar` | `null` |
| `securitytitlefootnoteidid` | `varchar` | `null` |
| `securitytitlevalue` | `varchar` | `"2007 Stock Options"` |
| `sharesownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `sharesownedfollowingtransactionvalue` | `varchar` | `"0"` |
| `transactionacquireddisposedcodefootnoteidid` | `varchar` | `null` |
| `transactionacquireddisposedcodevalue` | `varchar` | `"D"` |
| `transactioncode` | `varchar` | `"M"` |
| `transactioncodingfootnoteidid` | `varchar` | `null` |
| `transactiondatefootnoteidid` | `varchar` | `null` |
| `transactiondatevalue` | `varchar` | `"2016-11-09"` |
| `transactionformtype` | `varchar` | `"4"` |
| `transactionpricepersharefootnoteidid` | `varchar` | `null` |
| `transactionpricepersharevalue` | `varchar` | `"0"` |
| `transactionsharesfootnoteidid` | `varchar` | `null` |
| `transactionsharesvalue` | `varchar` | `"847"` |
| `transactiontimelinessfootnoteidid` | `varchar` | `null` |
| `transactiontimelinessvalue` | `varchar` | `null` |
| `transactiontotalvaluefootnoteidid` | `varchar` | `null` |
| `transactiontotalvaluevalue` | `varchar` | `null` |
| `underlyingsecuritysharesfootnoteidid` | `varchar` | `null` |
| `underlyingsecuritysharesvalue` | `varchar` | `"847"` |
| `underlyingsecuritytitlefootnoteidid` | `varchar` | `null` |
| `underlyingsecuritytitlevalue` | `varchar` | `"Common Stock"` |
| `underlyingsecurityvaluefootnoteidid` | `varchar` | `null` |
| `underlyingsecurityvaluevalue` | `varchar` | `null` |
| `value` | `varchar` | `"54.33"` |
| `valueownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `valueownedfollowingtransactionvalue` | `varchar` | `null` |

### 345_footnote

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `120919119059630` |
| `filingdate` | `varchar` | `"2019-12-09"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-12-09/345_footnote/000120919119059630.parquet"` |
| `_table` | `varchar` | `"345_footnote"` |
| `footnoteid` | `varchar` | `"F2"` |
| `footnotetext` | `varchar` | `"The restricted stock units vest in two equal installments over a two-year period so that 100% of the restricted stock units shall become vested as of December 6, 2020. These restricted stock units...` |

### 345_non_derivative_holding

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `4619503000051` |
| `filingdate` | `varchar` | `"2003-05-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2003-05-05/345_non_derivative_holding/000004619503000051.parquet"` |
| `_table` | `varchar` | `"345_non_derivative_holding"` |
| `directorindirectownershipfootnoteidid` | `varchar` | `null` |
| `directorindirectownershipvalue` | `varchar` | `"I"` |
| `footnoteidid` | `varchar` | `null` |
| `id` | `varchar` | `null` |
| `natureofownershipfootnoteidid` | `varchar` | `null` |
| `natureofownershipvalue` | `varchar` | `"Owned by Baldwin Pacific Corp."` |
| `sharesownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `sharesownedfollowingtransactionvalue` | `varchar` | `"2674"` |
| `transactionformtype` | `varchar` | `null` |
| `value` | `varchar` | `"Common Stock"` |
| `valueownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `valueownedfollowingtransactionvalue` | `varchar` | `null` |

### 345_non_derivative_security

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `497703000117` |
| `filingdate` | `varchar` | `"2003-05-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2003-05-05/345_non_derivative_security/000000497703000117.parquet"` |
| `_table` | `varchar` | `"345_non_derivative_security"` |
| `directorindirectownershipfootnoteidid` | `varchar` | `null` |
| `directorindirectownershipvalue` | `varchar` | `"D"` |
| `equityswapinvolved` | `varchar` | `"0"` |
| `footnoteidid` | `varchar` | `null` |
| `id` | `varchar` | `null` |
| `natureofownershipfootnoteidid` | `varchar` | `null` |
| `natureofownershipvalue` | `varchar` | `null` |
| `securitytitlevalue` | `varchar` | `"Common Stock"` |
| `sharesownedfollowingtransactionfootnoteidid` | `varchar` | `"F1"` |
| `sharesownedfollowingtransactionvalue` | `varchar` | `"130365"` |
| `transactionacquireddisposedcodefootnoteidid` | `varchar` | `null` |
| `transactionacquireddisposedcodevalue` | `varchar` | `"A"` |
| `transactioncode` | `varchar` | `"M"` |
| `transactioncodingfootnoteidid` | `varchar` | `null` |
| `transactiondatefootnoteidid` | `varchar` | `null` |
| `transactiondatevalue` | `varchar` | `"2003-05-01"` |
| `transactionformtype` | `varchar` | `"4"` |
| `transactionsharesfootnoteidid` | `varchar` | `null` |
| `transactionsharesvalue` | `varchar` | `"2669"` |
| `transactiontimelinessvalue` | `varchar` | `"E"` |
| `transactionvaluefootnoteidid` | `varchar` | `null` |
| `transactionvaluevalue` | `varchar` | `"4.7084"` |
| `value` | `varchar` | `null` |
| `valueownedfollowingtransactionvalue` | `varchar` | `null` |

### 345_non_derivative_transaction

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `167660119000008` |
| `filingdate` | `varchar` | `"2019-03-11"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-03-11/345_non_derivative_transaction/000167660119000008.parquet"` |
| `_table` | `varchar` | `"345_non_derivative_transaction"` |
| `directorindirectownershipfootnoteidid` | `varchar` | `null` |
| `directorindirectownershipvalue` | `varchar` | `"D"` |
| `equityswapinvolved` | `varchar` | `"0"` |
| `footnoteidid` | `varchar` | `"F1\|F2"` |
| `id` | `varchar` | `null` |
| `natureofownershipfootnoteidid` | `varchar` | `null` |
| `natureofownershipvalue` | `varchar` | `"Owned by Spouse"` |
| `securitytitlevalue` | `varchar` | `"Common"` |
| `sharesownedfollowingtransactionfootnoteidid` | `varchar` | `"F6"` |
| `sharesownedfollowingtransactionvalue` | `varchar` | `"25814531"` |
| `transactionacquireddisposedcodefootnoteidid` | `varchar` | `null` |
| `transactionacquireddisposedcodevalue` | `varchar` | `"A"` |
| `transactioncode` | `varchar` | `"P"` |
| `transactioncodingfootnoteidid` | `varchar` | `"F1"` |
| `transactiondatefootnoteidid` | `varchar` | `null` |
| `transactiondatevalue` | `varchar` | `"2019-03-08"` |
| `transactionformtype` | `varchar` | `"4"` |
| `transactionpricepersharefootnoteidid` | `varchar` | `"F1"` |
| `transactionpricepersharevalue` | `varchar` | `"1.2"` |
| `transactionsharesfootnoteidid` | `varchar` | `"F5"` |
| `transactionsharesvalue` | `varchar` | `"38911"` |
| `transactiontimelinessfootnoteidid` | `varchar` | `null` |
| `transactiontimelinessvalue` | `varchar` | `null` |
| `value` | `varchar` | `null` |
| `valueownedfollowingtransactionfootnoteidid` | `varchar` | `null` |
| `valueownedfollowingtransactionvalue` | `varchar` | `null` |

### 345_owner_signature

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `112760215030418` |
| `filingdate` | `varchar` | `"2015-11-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-11-05/345_owner_signature/000112760215030418.parquet"` |
| `_table` | `varchar` | `"345_owner_signature"` |
| `signaturedate` | `varchar` | `"2015-11-05"` |
| `signaturename` | `varchar` | `"Michael E. Keller"` |

### 345_reporting_owner

document_types: `3`, `3/A`, `4`, `4/A`, `5`, `5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `110465920051710` |
| `filingdate` | `varchar` | `"2020-04-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2020-04-27/345_reporting_owner/000110465920051710.parquet"` |
| `_table` | `varchar` | `"345_reporting_owner"` |
| `isdirector` | `varchar` | `"1"` |
| `isofficer` | `varchar` | `"0"` |
| `isother` | `varchar` | `"0"` |
| `istenpercentowner` | `varchar` | `"0"` |
| `officertitle` | `varchar` | `"SVP - Chief Legal & HR Officer"` |
| `othertext` | `varchar` | `null` |
| `rptownercik` | `varchar` | `"0001810238"` |
| `rptownercity` | `varchar` | `"BOSTON"` |
| `rptownername` | `varchar` | `"Nada Hany M"` |
| `rptownerstate` | `varchar` | `"MA"` |
| `rptownerstatedescription` | `varchar` | `null` |
| `rptownerstreet1` | `varchar` | `"C/O DRAFTKINGS INC."` |
| `rptownerstreet2` | `varchar` | `"222 BERKELEY STREET, 5TH FLOOR"` |
| `rptownerzipcode` | `varchar` | `"02116"` |

### ats_n_ua

document_types: `ATS-N-C`, `ATS-N-W`, `ATS-N/CA`, `ATS-N/MA`, `ATS-N/OFA`, `ATS-N/UA`

Athena queries are currently unavailable because this table's catalog metadata contains duplicate columns. The types below describe the Parquet data; Athena types and sample values are unavailable.

| Column | Source Parquet dtype (unverified) |
|---|---|
| `accessionnumber` | `uint64` |
| `filingdate` | `string` |
| `_sourcekey` | `string` |
| `_table` | `string` |
| `affiliatespermittedtoenterinterestrbpart2item2aareafflpermittedtoenterinterest` | `string` |
| `cbpart1item8exhibit1atwebsite` | `string` |
| `cbpart1item9exhibit2atwebsite` | `string` |
| `cbpart3item26iinforqstdundrexbt4avlblatwebst` | `string` |
| `cbpart3item26iiinforqstdundrexbt5avlblatwebst` | `string` |
| `ccc` | `string` |
| `cik` | `string` |
| `city` | `string` |
| `confirmingcopyflag` | `string` |
| `contactemailaddress` | `string` |
| `contactname` | `string` |
| `contactphonenumber` | `string` |
| `coverrboperatespursuanttoformats` | `string` |
| `dateceasetooperate` | `string` |
| `filenumber` | `string` |
| `livetestflag` | `string` |
| `mpid` | `string` |
| `nmsstockatsname` | `string` |
| `overrideinternetflag` | `string` |
| `part1item5beffectivemembershipdate` | `string` |
| `part2item1aarepermittedtoenterinterestrbpart2item1aarepermittedtoenterinterest` | `string` |
| `part2item1baresevicessametoallsubscribersrbpart2item1baresevicessametoallsubscribers` | `string` |
| `part2item1baresevicessametoallsubscriberstapart2item2bexplaindiff` | `string` |
| `part2item2baresevicestoafflsametosubscribersrbpart2item2baresevicestoafflsametosubscribers` | `string` |
| `part2item3acansubscroptoutwithoatiofafflrbpart2item3acansubscroptoutwithoatiofaffl` | `string` |
| `part2item3acansubscroptoutwithoatiofbdrbpart2item3acansubscroptoutwithoatiofbd` | `string` |
| `part2item3careoptoutsametoallsubscribersrbpart2item3careoptoutsametoallsubscribers` | `string` |
| `part2item4aaretherearrangementsbtwbdandtcrbpart2item4aaretherearrangementsbtwbdandtc` | `string` |
| `part2item5baresevicessametoallsubscribersandbdrbpart2item5baresevicessametoallsubscribersandbd` | `string` |
| `part2item6cdoesserviceprovideruseatsservicesrbpart2item6cdoesserviceprovideruseatsservices` | `string` |
| `part2item7bcansubscriberconsenttodisclosurerbpart2item7bcansubscriberconsenttodisclosure` | `string` |
| `part3item11bmeansfeciltsdtlsrbpart3item11bismeansfeciltssameforall` | `string` |
| `part3item11ddiffdtlsrbpart3item11disprocsrulssameforall` | `string` |
| `part3item13asegmntdtlsrbpart3item13aisordrtisegmntd` | `string` |
| `part3item13bsegmntdtlsrbpart3item13bissegmntatnsameforall` | `string` |
| `part3item13earngmntdtlsrbpart3item13eisdsclosrsameforall` | `string` |
| `part3item14bselectdtlsrbpart3item14bisselectnsameforall` | `string` |
| `part3item15cdsplyprocdtlsrbpart3item15cisdsplyprocsameforall` | `string` |
| `part3item16baffirminstrdtlsrbpart3item16bisroutdbefrinstr` | `string` |
| `part3item17aaffirinstrdtlsrbpart3item17aisdiffbtwnordtitrtmnt` | `string` |
| `part3item22bmtrlarngmntdiffdtlsrbpart3item22bismtrlarngmtsamefrall` | `string` |
| `part3item26platfrmdatarbpart3item26isordrfloexecstatspublshd` | `string` |
| `part3item2csummaryofconditionsrbpart3item2cisconditionssameforall` | `string` |
| `part3item3bsummaryofconditionsrbpart3item3biscondtnssameforall` | `string` |
| `part3item5bprotocoldetailsrbpart3item5bisprotclsameforall` | `string` |
| `part3item5cothrdtlsrbpart3item5cisanyothermeans` | `string` |
| `part3item5dtncdetailsrbpart3item5distncsameforall` | `string` |
| `part3item6aprotocoldetailsrbpart3item6aiscolocrltdsrvcsofrd` | `string` |
| `part3item6btncdetailsrbpart3item6bistncsameforall` | `string` |
| `part3item7btncdetailsrbpart3item7bistncsameforall` | `string` |
| `part3item8breqprocdetailsrbpart3item8bisreqprocsameforall` | `string` |
| `part3item8coddltordrreqsrbpart3item8cisoddlotsacptdexecutd` | `string` |
| `part3item9amsgdtlsrbpart3item9aisanymsgtoindicti` | `string` |
| `part3item9bmsgdtlsrbpart3item9bisindintrstsameforall` | `string` |
| `rboperatespursuanttoformats` | `string` |
| `rbpart1item1isbd` | `string` |
| `rbpart2item1aarepermittedtoenterinterest` | `string` |
| `rbpart2item1baresevicessametoallsubscribers` | `string` |
| `rbpart2item1caretherearrangements` | `string` |
| `rbpart2item1dcanoatinterestberouted` | `string` |
| `rbpart2item2aareafflpermittedtoenterinterest` | `string` |
| `rbpart2item2baresevicestoafflsametosubscribers` | `string` |
| `rbpart2item2caretherearrangementswithaffl` | `string` |
| `rbpart2item2dcanoatiberoutedbyaffl` | `string` |
| `rbpart2item3acansubscroptoutwithoatiofaffl` | `string` |
| `rbpart2item3acansubscroptoutwithoatiofbd` | `string` |
| `rbpart2item3careoptoutsametoallsubscribers` | `string` |
| `rbpart2item4aaretherearrangementsbtwbdandtc` | `string` |
| `rbpart2item4baretherearrangementsbtwafflandtc` | `string` |
| `rbpart2item5baresevicessametoallsubscribersandbd` | `string` |
| `rbpart2item5adoesofferproductsandservices` | `string` |
| `rbpart2item5cdoesafflofferproductsandservices` | `string` |
| `rbpart2item6cdoesserviceprovideruseatsservices` | `string` |
| `rbpart2item6dareatssevicessametoall` | `string` |
| `rbpart2item6adoesemployeeaccessconfidentialinfo` | `string` |
| `rbpart2item6bdoesanyentitysupportservices` | `string` |
| `rbpart2item7bcansubscriberconsenttodisclosure` | `string` |
| `rbpart2item7ccansubscriberwithdrawconsent` | `string` |
| `rbpart3item10eisanydifbtwnpreopexecflwngstpg` | `string` |
| `rbpart3item10bisopnreopnsameforall` | `string` |
| `rbpart3item10disanydifbtwnexeproctrdhrs` | `string` |
| `rbpart3item10eisanydifbtwnpreopexecflwngstpg` | `string` |
| `rbpart3item11bismeansfeciltssameforall` | `string` |
| `rbpart3item11disprocsrulssameforall` | `string` |
| `rbpart3item12aisanyfrmlinfrmlarngmnts` | `string` |
| `rbpart3item13aisordrtisegmntd` | `string` |
| `rbpart3item13bissegmntatnsameforall` | `string` |
| `rbpart3item13dissegcatgdisclosd` | `string` |
| `rbpart3item13eisdsclosrsameforall` | `string` |
| `rbpart3item13ciscustmrordr` | `string` |
| `rbpart3item14aisdsgtointrctornot` | `string` |
| `rbpart3item14bisselectnsameforall` | `string` |
| `rbpart3item14aisdsgtointrctornot` | `string` |
| `rbpart3item15bissubscrbordbnd` | `string` |
| `rbpart3item15cisdsplyprocsameforall` | `string` |
| `rbpart3item15aiselectrnccommu` | `string` |
| `rbpart3item15bissubscrbordbnd` | `string` |
| `rbpart3item16aisinstroutd` | `string` |
| `rbpart3item16bisroutdbefrinstr` | `string` |
| `rbpart3item16aisinstroutd` | `string` |
| `rbpart3item17aisdiffbtwnordtitrtmnt` | `string` |
| `rbpart3item17bistrtmntsameforall` | `string` |
| `rbpart3item17bistrtmntsameforall` | `string` |
| `rbpart3item18aisoutsdetrdinghrs` | `string` |
| `rbpart3item20bissuspndprocdursamefrall` | `string` |
| `rbpart3item20bissuspndprocdursamefrall` | `string` |
| `rbpart3item21bismtrlarngmtsamefrall` | `string` |
| `rbpart3item22bismtrlarngmtsamefrall` | `string` |
| `rbpart3item23bissrcsamefrall` | `string` |
| `rbpart3item24aissubscrbrordr` | `string` |
| `rbpart3item25aisavgdlytradinvolexcd` | `string` |
| `rbpart3item25biscmplyrule301` | `string` |
| `rbpart3item25aisavgdlytradinvolexcd` | `string` |
| `rbpart3item26isordrfloexecstatspublshd` | `string` |
| `rbpart3item2cisconditionssameforall` | `string` |
| `rbpart3item2aregisteredbd` | `string` |
| `rbpart3item2bisthereotherconditions` | `string` |
| `rbpart3item2distherewrittenagreement` | `string` |
| `rbpart3item3biscondtnssameforall` | `string` |
| `rbpart3item3aisexcludesubscriber` | `string` |
| `rbpart3item4bishrsofoperationsame` | `string` |
| `rbpart3item5aispermitordrtradng` | `string` |
| `rbpart3item5bisprotclsameforall` | `string` |
| `rbpart3item5cisanyothermeans` | `string` |
| `rbpart3item5distncsameforall` | `string` |
| `rbpart3item5aispermitordrtradng` | `string` |
| `rbpart3item6aiscolocrltdsrvcsofrd` | `string` |
| `rbpart3item6bistncsameforall` | `string` |
| `rbpart3item6cisanyothermeans` | `string` |
| `rbpart3item6eisanyrducdspofcom` | `string` |
| `rbpart3item7bistncsameforall` | `string` |
| `rbpart3item8bisreqprocsameforall` | `string` |
| `rbpart3item8cisoddlotsacptdexecutd` | `string` |
| `rbpart3item8disreqsprocdursameforall` | `string` |
| `rbpart3item8eismixlotordrsacptdexecutd` | `string` |
| `rbpart3item8aisminormaxsizereqd` | `string` |
| `rbpart3item8eismixlotordrsacptdexecutd` | `string` |
| `rbpart3item8fisrecprocsameforall` | `string` |
| `rbpart3item9aisanymsgtoindicti` | `string` |
| `rbpart3item9bisindintrstsameforall` | `string` |
| `secondarysite7city` | `string` |
| `secondarysite7state` | `string` |
| `secondarysite7street1` | `string` |
| `secondarysite7street2` | `string` |
| `secondarysite7zip` | `string` |
| `state` | `string` |
| `street1` | `string` |
| `street2` | `string` |
| `submissiontype` | `string` |
| `tapart2item1aunitnamesenterinterest` | `string` |
| `tapart2item2aafflthatenterinterest` | `string` |
| `tapart2item2bexplaindiff` | `string` |
| `tapart2item3aexplianoptout` | `string` |
| `tapart2item3bexplianoptout` | `string` |
| `tapart2item3cexplaindiff` | `string` |
| `tapart2item4atdandatsservices` | `string` |
| `tapart2item5bexplaindiff` | `string` |
| `tapart2item5aproductsandservices` | `string` |
| `tapart2item6cproviderafflandservicesused` | `string` |
| `tapart2item6aunitafflemployeeservices` | `string` |
| `tapart2item6bserviceprovider` | `string` |
| `tapart2item7bexplainhowandconditions` | `string` |
| `tapart2item7cexplainhowandconditions` | `string` |
| `tapart2item7adescrofsafegaurdsandprocedures` | `string` |
| `tapart2item7dsummaryofrolesrespofpersons` | `string` |
| `tapart3item10ediffdtls` | `string` |
| `tapart3item10aopenreopendtls` | `string` |
| `tapart3item10cunexeordrtidtls` | `string` |
| `tapart3item11bmeansfeciltsdtls` | `string` |
| `tapart3item11ddiffdtls` | `string` |
| `tapart3item11astrucofnmsstk` | `string` |
| `tapart3item11crulsprocsofnmsstk` | `string` |
| `tapart3item13asegprocdurdtls` | `string` |
| `tapart3item13bsegdiffdtls` | `string` |
| `tapart3item13ddsclosrcontntdtls` | `string` |
| `tapart3item13edsclosrdiffdtls` | `string` |
| `tapart3item14bselectndiffdtls` | `string` |
| `tapart3item14acntrprtydtls` | `string` |
| `tapart3item15bsubscrbnddtls` | `string` |
| `tapart3item16baffirminstrdiffdtls` | `string` |
| `tapart3item16baffirminstrdiffdtlsno` | `string` |
| `tapart3item17atrtmntdiffdtls` | `string` |
| `tapart3item17bdiffdtls` | `string` |
| `tapart3item19asrvcusgfees` | `string` |
| `tapart3item19bbundldsrvcusgfees` | `string` |
| `tapart3item19crbtdiscoffees` | `string` |
| `tapart3item1othersubscrbrdtls` | `string` |
| `tapart3item1subscribertype` | `string` |
| `tapart3item20bdiffdtls` | `string` |
| `tapart3item20asuspndprocdur` | `string` |
| `tapart3item21amtrlarngmntdtls` | `string` |
| `tapart3item22bdiffdtls` | `string` |
| `tapart3item22amtrlarngmntdtls` | `string` |
| `tapart3item23amrktdatsrc` | `string` |
| `tapart3item25bitickrsymbol` | `string` |
| `tapart3item25biidwrtnstndrds` | `string` |
| `tapart3item2csummaryofdifferences` | `string` |
| `tapart3item2bsummaryofcndtns` | `string` |
| `tapart3item3bsummaryofdifferences` | `string` |
| `tapart3item3aexcludngsumrydtls` | `string` |
| `tapart3item4ahrsofoperation` | `string` |
| `tapart3item5aprotocolsumrydtls` | `string` |
| `tapart3item5cdsplyprocdiffdtls` | `string` |
| `tapart3item5cothrmeansdtls` | `string` |
| `tapart3item5dtncsumrydtls` | `string` |
| `tapart3item5aprotocolused` | `string` |
| `tapart3item6acolocrltdsrvcsdtls` | `string` |
| `tapart3item6btncsumrydtls` | `string` |
| `tapart3item7aordrtypexplain` | `string` |
| `tapart3item7btncsumrydtls` | `string` |
| `tapart3item8bdiffrncsinotireqrmnts` | `string` |
| `tapart3item8coddltordrreqsnprocdurs` | `string` |
| `tapart3item8aotisizereqrmns` | `string` |
| `tapart3item8emixltordrreqsprocdtls` | `string` |
| `tapart3item9amsgusgdtls` | `string` |
| `tapart3item9bmsgusgdtls` | `string` |
| `tastatementaboutamendment` | `string` |
| `txnmsstockatsname` | `string` |
| `txpart1item2atsname` | `string` |
| `txpart1item3atsname` | `string` |
| `txpart1item4abdcrdnumber` | `string` |
| `txpart1item4abdfilenumber` | `string` |
| `txpart1item5ansafullname` | `string` |
| `txtpart1item5cnmsstockmpid` | `string` |
| `txtpart1item6uwebsite` | `string` |
| `zip` | `string` |

### c_a

document_types: `C`, `C-AR`, `C-AR-W`, `C-AR/A`, `C-U`, `C-U-W`, `C-W`, `C/A`, `C/A-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164460016000127` |
| `filingdate` | `varchar` | `"2016-05-16"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-05-16/c_a/000164460016000127.parquet"` |
| `_table` | `varchar` | `"c_a"` |
| `actreceivedmostrecentfiscalyear` | `varchar` | `"0.00"` |
| `actreceivedpriorfiscalyear` | `varchar` | `"0.00"` |
| `cashequimostrecentfiscalyear` | `varchar` | `"5993.00"` |
| `cashequipriorfiscalyear` | `varchar` | `"4900.00"` |
| `city` | `varchar` | `"SANTA MONICA"` |
| `commissioncik` | `varchar` | `"0001665160"` |
| `commissionfilenumber` | `varchar` | `"007-00007"` |
| `companyname` | `varchar` | `"StartEngine Capital LLC"` |
| `compensationamount` | `varchar` | `"7% to StartEngine"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `costgoodssoldmostrecentfiscalyear` | `varchar` | `"0.00"` |
| `costgoodssoldpriorfiscalyear` | `varchar` | `"0.00"` |
| `crdnumber` | `varchar` | `"282945"` |
| `currentemployees` | `varchar` | `"8"` |
| `dateincorporation` | `varchar` | `"11-10-2014"` |
| `deadlinedate` | `varchar` | `"10-31-2016"` |
| `descoversubscription` | `varchar` | `"At the Company's discretion"` |
| `filenumber` | `varchar` | `"020-22831"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001674213"` |
| `financialinterest` | `varchar` | `"N/A"` |
| `isamendment` | `varchar` | `"false"` |
| `iscoissuer` | `varchar` | `null` |
| `issuejurisdictionsecuritiesoffering` | `varchar` | `"AL\|AK\|AZ\|AR\|CA\|CO\|CT\|DE\|DC\|FL\|GA\|HI\|ID\|IL\|IN\|IA\|KS\|KY\|LA\|ME\|MD\|MA\|MI\|MN\|MS\|MO\|MT\|NE\|NV\|NH\|NJ\|NM\|NY\|NC\|ND\|OH\|OK\|OR\|PA\|PR\|RI\|SC\|SD\|TN\|TX\|UT\|VT\|VA\|WA\|WV\|WI\|WY\|A0\|A1\|A2\|A3\|A4\|A5\|A6\|A7\|A8\|A9\|B0\|Z4"` |
| `issuer` | `varchar` | `"Gigmor, Inc"` |
| `issuersignature` | `varchar` | `"David Baird"` |
| `issuertitle` | `varchar` | `"CEO"` |
| `issuerwebsite` | `varchar` | `"www.gigmor.com"` |
| `jurisdictionorganization` | `varchar` | `"DE"` |
| `legalstatusform` | `varchar` | `"Corporation"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `longtermdebtmostrecentfiscalyear` | `varchar` | `"670062.00"` |
| `longtermdebtpriorfiscalyear` | `varchar` | `"280643.00"` |
| `maximumofferingamount` | `varchar` | `"1000000.00"` |
| `nameofissuer` | `varchar` | `"Gigmor, Inc"` |
| `natureofamendment` | `varchar` | `"We are adding an attachment with the full offering terms and other details for the Form C"` |
| `netincomemostrecentfiscalyear` | `varchar` | `"-459638.00"` |
| `netincomepriorfiscalyear` | `varchar` | `"-290958.00"` |
| `noofsecurityoffered` | `varchar` | `"750000"` |
| `offeringamount` | `varchar` | `"300000.00"` |
| `oversubscriptionaccepted` | `varchar` | `"Y"` |
| `oversubscriptionallocationtype` | `varchar` | `"First-come, first-served basis"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `period` | `varchar` | `null` |
| `price` | `varchar` | `"0.40000"` |
| `pricedeterminationmethod` | `varchar` | `null` |
| `progressupdate` | `varchar` | `null` |
| `returncopyflag` | `varchar` | `"true"` |
| `revenuemostrecentfiscalyear` | `varchar` | `"0.00"` |
| `revenuepriorfiscalyear` | `varchar` | `"0.00"` |
| `securityofferedotherdesc` | `varchar` | `"LLC/Membership Interests"` |
| `securityofferedtype` | `varchar` | `"Common Stock"` |
| `shorttermdebtmostrecentfiscalyear` | `varchar` | `"35611.00"` |
| `shorttermdebtpriorfiscalyear` | `varchar` | `"34585.00"` |
| `stateorcountry` | `varchar` | `"CA"` |
| `street1` | `varchar` | `"844 BERKELEY STREET"` |
| `street2` | `varchar` | `"SUITE 120"` |
| `submissiontype` | `varchar` | `"C"` |
| `taxpaidmostrecentfiscalyear` | `varchar` | `"420.00"` |
| `taxpaidpriorfiscalyear` | `varchar` | `"820.00"` |
| `totalassetmostrecentfiscalyear` | `varchar` | `"161623.00"` |
| `totalassetpriorfiscalyear` | `varchar` | `"73417.00"` |
| `zipcode` | `varchar` | `"90403"` |

### c_co_issuer

document_types: `C`, `C-AR`, `C-AR-W`, `C-AR/A`, `C-U`, `C-U-W`, `C-W`, `C/A`, `C/A-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `182198221000001` |
| `filingdate` | `varchar` | `"2021-03-30"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2021-03-30/c_co_issuer/000182198221000001.parquet"` |
| `_table` | `varchar` | `"c_co_issuer"` |
| `coissueraddresscity` | `varchar` | `"Albemarle"` |
| `coissueraddressstateorcountry` | `varchar` | `"NC"` |
| `coissueraddressstreet1` | `varchar` | `"197 N. Second Street"` |
| `coissueraddresszipcode` | `varchar` | `"28001"` |
| `coissuercik` | `varchar` | `null` |
| `coissuerlegalstatusdateincorporation` | `varchar` | `"06-29-2020"` |
| `coissuerlegalstatusjurisdictionorganization` | `varchar` | `"NC"` |
| `coissuerlegalstatuslegalstatusform` | `varchar` | `"Limited Liability Company"` |
| `coissuerwebsite` | `varchar` | `"https://wefunder.com/wefunder"` |
| `isedgarfiler` | `varchar` | `null` |
| `nameofcoissuer` | `varchar` | `"AHD Investors, LLC"` |

### c_signature_person

document_types: `C`, `C-AR`, `C-AR-W`, `C-AR/A`, `C-U`, `C-U-W`, `C-W`, `C/A`, `C/A-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164460016000127` |
| `filingdate` | `varchar` | `"2016-05-16"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-05-16/c_signature_person/000164460016000127.parquet"` |
| `_table` | `varchar` | `"c_signature_person"` |
| `personsignature` | `varchar` | `"David Baird"` |
| `persontitle` | `varchar` | `"CEO, CFO, Chief Accounting Officer, Sole Director"` |
| `signaturedate` | `varchar` | `"05-16-2016"` |

### c_tr

document_types: `C-TR`, `C-TR-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164460017000113` |
| `filingdate` | `varchar` | `"2017-06-06"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2017-06-06/c_tr/000164460017000113.parquet"` |
| `_table` | `varchar` | `"c_tr"` |
| `city` | `varchar` | `"SAN FRANCISCO"` |
| `dateincorporation` | `varchar` | `"07-24-2013"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001597895"` |
| `issuersignature` | `varchar` | `"Traveling Spoon"` |
| `issuersignaturetext` | `varchar` | `"Stephanie Lawrence"` |
| `issuertitle` | `varchar` | `"Co-Chief Executive Officer and Director"` |
| `issuerwebsite` | `varchar` | `"www.travelingspoon.com"` |
| `jurisdictionorganization` | `varchar` | `"DE"` |
| `legalstatusform` | `varchar` | `"Corporation"` |
| `legalstatusotherdesc` | `varchar` | `null` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `nameofissuer` | `varchar` | `"Traveling Spoon"` |
| `stateorcountry` | `varchar` | `"CA"` |
| `street1` | `varchar` | `"PO BOX 40758"` |
| `street2` | `varchar` | `"SUITE 250"` |
| `submissiontype` | `varchar` | `"C-TR"` |
| `zipcode` | `varchar` | `"94140"` |

### c_tr_co_issuer

document_types: `C-TR`, `C-TR-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `190834023000002` |
| `filingdate` | `varchar` | `"2023-04-26"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2023-04-26/c_tr_co_issuer/000190834023000002.parquet"` |
| `_table` | `varchar` | `"c_tr_co_issuer"` |
| `city` | `varchar` | `"San Francisco"` |
| `coissuercik` | `varchar` | `null` |
| `coissuerwebsite` | `varchar` | `"www.wefunder.com"` |
| `dateincorporation` | `varchar` | `"04-27-2022"` |
| `jurisdictionorganization` | `varchar` | `"DE"` |
| `legalstatusform` | `varchar` | `"Limited Liability Company"` |
| `legalstatusotherdesc` | `varchar` | `null` |
| `nameofcoissuer` | `varchar` | `"Beetexting I"` |
| `stateorcountry` | `varchar` | `"CA"` |
| `street1` | `varchar` | `"4104 24th St."` |
| `street2` | `varchar` | `"PMB 8113"` |
| `zipcode` | `varchar` | `"94114"` |

### c_tr_signature_person

document_types: `C-TR`, `C-TR-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `164460017000113` |
| `filingdate` | `varchar` | `"2017-06-06"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2017-06-06/c_tr_signature_person/000164460017000113.parquet"` |
| `_table` | `varchar` | `"c_tr_signature_person"` |
| `personsignature` | `varchar` | `"Stephanie Lawrence"` |
| `persontitle` | `varchar` | `"Co-Chief Executive Officer and Director"` |
| `signaturedate` | `varchar` | `"06-06-2017"` |

### cfportal

document_types: `CFPORTAL`, `CFPORTAL-W`, `CFPORTAL/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `166480416000001` |
| `filingdate` | `varchar` | `"2016-01-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-01-29/cfportal/000166480416000001.parquet"` |
| `_table` | `varchar` | `"cfportal"` |
| `acquireddesc` | `varchar` | `null` |
| `acquiredfundingportal` | `varchar` | `null` |
| `acquiredportalfilenumber` | `varchar` | `null` |
| `agentname` | `varchar` | `null` |
| `amendmentexplanation` | `varchar` | `"Updated information to include 3rd Party Details and Control persons update including CRD numbers and additions"` |
| `anyforeignregistrations` | `varchar` | `"N"` |
| `anypreviousregistrations` | `varchar` | `"N"` |
| `apcrdnumber` | `varchar` | `null` |
| `associatedpersonciviljudicialdrpdetailsportalstateorcountry` | `varchar` | `null` |
| `associatedpersondetailsscheduleacrdnumber` | `varchar` | `null` |
| `bookkeepingentityaddressportalcity` | `varchar` | `null` |
| `bookkeepingentityaddressportalstateorcountry` | `varchar` | `null` |
| `bookkeepingentityaddressportalstreet1` | `varchar` | `null` |
| `bookkeepingentityaddressportalstreet2` | `varchar` | `null` |
| `bookkeepingentityaddressportalzipcode` | `varchar` | `null` |
| `bookkeepingentityfax` | `varchar` | `null` |
| `bookkeepingentityname` | `varchar` | `null` |
| `bookkeepingentityphone` | `varchar` | `null` |
| `bookkeepingentitytype` | `varchar` | `null` |
| `bookkeepinglocationdesc` | `varchar` | `null` |
| `cityorcounty` | `varchar` | `null` |
| `civilactioncourtname` | `varchar` | `null` |
| `civilactioncourttype` | `varchar` | `null` |
| `civilisfoundinviolationofregulation` | `varchar` | `"N"` |
| `civiljudicialdrpdetailscityorcounty` | `varchar` | `null` |
| `civiljudicialdrpdetailscivilactioncourtname` | `varchar` | `null` |
| `civiljudicialdrpdetailscivilactioncourttype` | `varchar` | `null` |
| `civiljudicialdrpdetailscourtactioninitiatorname` | `varchar` | `null` |
| `civiljudicialdrpdetailsdescribecivilactionallegations` | `varchar` | `null` |
| `civiljudicialdrpdetailsdocketorcasenumber` | `varchar` | `null` |
| `civiljudicialdrpdetailseventcurrentstatus` | `varchar` | `null` |
| `civiljudicialdrpdetailsfilingdateofcourtactionexactorexplaindate` | `varchar` | `null` |
| `civiljudicialdrpdetailsfilingdateofcourtactionexactorexplainexactorexplanation` | `varchar` | `null` |
| `civiljudicialdrpdetailsgrantorfineamount` | `varchar` | `null` |
| `civiljudicialdrpdetailsmatterresolvetype` | `varchar` | `null` |
| `civiljudicialdrpdetailsotherprincipalproducttype` | `varchar` | `null` |
| `civiljudicialdrpdetailsportalstateorcountry` | `varchar` | `null` |
| `civiljudicialdrpdetailsprincipalproducttype` | `varchar` | `null` |
| `civiljudicialdrpdetailsprincipalreliefsought` | `varchar` | `null` |
| `civiljudicialdrpdetailssanctiondetail` | `varchar` | `null` |
| `civiljudicialdrpdetailssummaryofcircumstances` | `varchar` | `null` |
| `civiljudicialdrpdrpfiledfor` | `varchar` | `null` |
| `civiljudicialdrpinitialoramended` | `varchar` | `null` |
| `contactfirstname` | `varchar` | `"Stephen"` |
| `contactlastname` | `varchar` | `"Catanzano"` |
| `contactmiddlename` | `varchar` | `"Frank"` |
| `contactprefix` | `varchar` | `"Mr."` |
| `contacttitle` | `varchar` | `"President"` |
| `controlaffiliatetype` | `varchar` | `null` |
| `controlrelationshipfulllegalname` | `varchar` | `"Stephen Catanzano\|Paul O'Brien"` |
| `courtactioninitiatorname` | `varchar` | `null` |
| `date` | `varchar` | `null` |
| `datebusinessceasedwithdrawn` | `varchar` | `null` |
| `dateincorporation` | `varchar` | `"01-13-2016"` |
| `describecivilactionallegations` | `varchar` | `null` |
| `docketorcasenumber` | `varchar` | `null` |
| `doesapphaveliens` | `varchar` | `"N"` |
| `drpfiledfor` | `varchar` | `null` |
| `escrowcompensationdesc` | `varchar` | `"Issuers will pay an upfront fee for listing in our portal.  In addition they pay a success fee of 3.5% cash of the equity raised and 3.5% in equity at the same terms as all investors.  Example:  I...` |
| `eventcurrentstatus` | `varchar` | `null` |
| `exactorexplanation` | `varchar` | `null` |
| `executiondate` | `varchar` | `"01-29-2016"` |
| `executionfulllegalname` | `varchar` | `"Jumpstart Micro, Inc"` |
| `executionsignature` | `varchar` | `"Stephen Catanzano"` |
| `executiontitle` | `varchar` | `"President"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001664804"` |
| `filingdateofcourtactionexactorexplaindate` | `varchar` | `null` |
| `filingdateofcourtactionexactorexplainexactorexplanation` | `varchar` | `null` |
| `fiscalyearend` | `varchar` | `"December"` |
| `fullname` | `varchar` | `null` |
| `grantorfineamount` | `varchar` | `null` |
| `hasbonddenied` | `varchar` | `"N"` |
| `hassubjectofbankruptcy` | `varchar` | `"N"` |
| `hastrusteeappointed` | `varchar` | `"N"` |
| `initialoramended` | `varchar` | `null` |
| `investorfundscity` | `varchar` | `"Phoenix\|New York"` |
| `investorfundscontactname` | `varchar` | `"Bank Escrow Agent: Alliance Bank (coincides with Transfer Agent Fund America )\|Registered Transfer Agent:  Fund America Stock Transfer"` |
| `investorfundscontactphone` | `varchar` | `"602-389-3500\|917-861-5472"` |
| `investorfundsstateorcountry` | `varchar` | `"AZ\|NY"` |
| `investorfundsstreet1` | `varchar` | `"1 East Washington Street\|641 Lexington Avenue"` |
| `investorfundsstreet2` | `varchar` | `"Suite 1518"` |
| `investorfundszipcode` | `varchar` | `"85004\|10022"` |
| `investorinitiatedcomplaint` | `varchar` | `null` |
| `irsemployeridnumber` | `varchar` | `"81-1075179"` |
| `isaddressprivateresidence` | `varchar` | `null` |
| `isauthorizedtoactattorney` | `varchar` | `"N"` |
| `iscauseofdenial` | `varchar` | `"N"` |
| `ischargedmisdemeanor` | `varchar` | `"N"` |
| `ischargedwithfelony` | `varchar` | `"N"` |
| `isconaffregisteredcrd` | `varchar` | `null` |
| `isconvictedmisdemeanor` | `varchar` | `"N"` |
| `isconvictedoffelony` | `varchar` | `"N"` |
| `isdeniedlicense` | `varchar` | `"N"` |
| `isdisciplined` | `varchar` | `"N"` |
| `isdismissed` | `varchar` | `"N"` |
| `isengagedinnonsecurities` | `varchar` | `"Y"` |
| `isenjoined` | `varchar` | `"N"` |
| `isfoundincauseofdenial` | `varchar` | `"N"` |
| `isfoundincauseofsuspension` | `varchar` | `"N"` |
| `isfoundinviolationofregulation` | `varchar` | `"N"` |
| `isfoundinviolationofrules` | `varchar` | `"N"` |
| `isfoundmadefalsestatement` | `varchar` | `"N"` |
| `isimposedpenalty` | `varchar` | `"N"` |
| `isinvestigated` | `varchar` | `null` |
| `ismadefalsestatement` | `varchar` | `"N"` |
| `isnamedincivilproceeding` | `varchar` | `"N"` |
| `isorderagainst` | `varchar` | `"N"` |
| `isorderagainstactivity` | `varchar` | `"N"` |
| `isregistered` | `varchar` | `null` |
| `isregulatorycomplaint` | `varchar` | `"N"` |
| `issucceedingbusiness` | `varchar` | `"N"` |
| `isunethical` | `varchar` | `"N"` |
| `isviolatedregulation` | `varchar` | `"N"` |
| `jurisdictionorganization` | `varchar` | `"DE"` |
| `legalnamechange` | `varchar` | `null` |
| `legalstatusform` | `varchar` | `"Corporation"` |
| `mailingaddressdifferent` | `varchar` | `"true"` |
| `mailingcity` | `varchar` | `"CARLISLE"` |
| `mailingstateorcountry` | `varchar` | `"MA"` |
| `mailingstreet1` | `varchar` | `"2 ROCKY POINT"` |
| `mailingstreet2` | `varchar` | `"2ND FLOOR"` |
| `mailingzipcode` | `varchar` | `"01741"` |
| `matterresolvetype` | `varchar` | `null` |
| `nameofportal` | `varchar` | `"Jumpstart Micro, Inc"` |
| `nonsecuritiesbusinessdesc` | `varchar` | `"In addition to our funding portal we have a marketplace where companies can advertise services which may be of interest to Issuers.  An example, is a company offering marketing or web design servi...` |
| `othernamesused` | `varchar` | `"Jumpstart Micro, Inc"` |
| `otherofficelocationaddressportalcity` | `varchar` | `"Santa Monica"` |
| `otherofficelocationaddressportalstateorcountry` | `varchar` | `"CA"` |
| `otherofficelocationaddressportalstreet1` | `varchar` | `"1538 20th Street"` |
| `otherofficelocationaddressportalstreet2` | `varchar` | `"2nd Floor"` |
| `otherofficelocationaddressportalzipcode` | `varchar` | `"90404"` |
| `otherprincipalproducttype` | `varchar` | `null` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `personregistered` | `varchar` | `null` |
| `persontype` | `varchar` | `null` |
| `portaladdressportalcity` | `varchar` | `"CARLISLE"` |
| `portaladdressportalstateorcountry` | `varchar` | `"MA"` |
| `portaladdressportalstreet1` | `varchar` | `"2 ROCKY POINT"` |
| `portaladdressportalstreet2` | `varchar` | `"2ND FLOOR"` |
| `portaladdressportalzipcode` | `varchar` | `"01741"` |
| `portalcity` | `varchar` | `null` |
| `portalcontactemail` | `varchar` | `"steve@jumpstartmicro.com"` |
| `portalcontactfax` | `varchar` | `"3104006655"` |
| `portalcontactphone` | `varchar` | `"6175106939"` |
| `portalstateorcountry` | `varchar` | `null` |
| `portalstreet1` | `varchar` | `null` |
| `portalstreet2` | `varchar` | `null` |
| `portalzipcode` | `varchar` | `null` |
| `prevnamesofportal` | `varchar` | `null` |
| `prevwebsiteurls` | `varchar` | `null` |
| `principalproducttype` | `varchar` | `null` |
| `principalreliefsought` | `varchar` | `null` |
| `privatecivillitigation` | `varchar` | `null` |
| `resolutiondateexactorexplaindate` | `varchar` | `null` |
| `resolutiondateexactorexplainexactorexplanation` | `varchar` | `null` |
| `respondingtoresponsequestion` | `varchar` | `null` |
| `responsequestion` | `varchar` | `null` |
| `returncopyflag` | `varchar` | `"true"` |
| `sanctiondetail` | `varchar` | `null` |
| `sanctionordered` | `varchar` | `null` |
| `sanctionrelieftypesanctionordered` | `varchar` | `null` |
| `schedulebcontrolperson` | `varchar` | `"Y\|Y\|Y"` |
| `schedulebcrdnumber` | `varchar` | `"006614892\|006614160\|006615682"` |
| `schedulebdateoftitlestatusacquired` | `varchar` | `"12/2013\|12/2013\|12/2013"` |
| `schedulebentitytype` | `varchar` | `"DE\|DE\|DE"` |
| `schedulebfulllegalname` | `varchar` | `"Kelman Martin Lewis\|Daniel Lewis  Kelman\|Steven Edward Nameroff"` |
| `schedulebownershipcode` | `varchar` | `"D\|C\|B"` |
| `schedulebtitlestatus` | `varchar` | `"Chief Operations Officer\|Chief Executive Officer\|Chief Financial Officer"` |
| `schedulebtypeofamendment` | `varchar` | `"A\|A\|A"` |
| `schedulecprintedname` | `varchar` | `null` |
| `schedulecsignature` | `varchar` | `null` |
| `schedulecsignaturedate` | `varchar` | `null` |
| `schedulectitle` | `varchar` | `null` |
| `secfilenumbers` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"CFPORTAL"` |
| `suffix` | `varchar` | `null` |
| `summaryofcircumstances` | `varchar` | `null` |
| `websiteofportal` | `varchar` | `"www.jumpstartmicro.com"` |

### cfportal_schedule_a_entity

document_types: `CFPORTAL`, `CFPORTAL-W`, `CFPORTAL/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `166480416000001` |
| `filingdate` | `varchar` | `"2016-01-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-01-29/cfportal_schedule_a_entity/000166480416000001.parquet"` |
| `_table` | `varchar` | `"cfportal_schedule_a_entity"` |
| `scheduleacontrolperson` | `varchar` | `"Y"` |
| `scheduleacrdnumber` | `varchar` | `"006320156"` |
| `scheduleadateoftitlestatusacquired` | `varchar` | `"01/2016"` |
| `scheduleaentitytype` | `varchar` | `"NP"` |
| `scheduleafulllegalname` | `varchar` | `"Catanzano, Stephen, Frank"` |
| `scheduleaownershipcode` | `varchar` | `"D"` |
| `scheduleatitlestatus` | `varchar` | `"President, CEO"` |

### cover_page

document_types: `COVER PAGE`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `111064419000021` |
| `filingdate` | `varchar` | `"2019-07-11"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-07-11/cover_page/000111064419000021.parquet"` |
| `_table` | `varchar` | `"cover_page"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `filenumber` | `varchar` | `"013-00078"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001110644"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `rboperatespursuanttoformats` | `varchar` | `"Y"` |
| `submissiontype` | `varchar` | `"ATS-N/MA"` |
| `tastatementaboutamendment` | `varchar` | `"This is an amendment to Item 7.a. of Part III. Effective on or after August 12, 2019, all Members will be able to send both manual targeted invitations and targeted invitations from algos, but onl...` |
| `txnmsstockatsname` | `varchar` | `"NMS Stock ATS"` |

### d

document_types: `D`, `D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `117162315000001` |
| `filingdate` | `varchar` | `"2006-07-03"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2006-07-03/d/000117162315000001.parquet"` |
| `_table` | `varchar` | `"d"` |
| `aggregatenetassetvaluerange` | `varchar` | `null` |
| `authorizedrepresentative` | `varchar` | `"false"` |
| `businesscombinationclarification` | `varchar` | `null` |
| `city` | `varchar` | `"CHARLOTTESVILLE"` |
| `dateoffirstsale` | `varchar` | `"2006-09-15"` |
| `dateoffirstsaleyettooccur` | `varchar` | `"true"` |
| `descriptionofothertype` | `varchar` | `null` |
| `edgarpreviousname` | `varchar` | `"None"` |
| `federalexemptionsitem` | `varchar` | `"06b"` |
| `findersfeedollaramount` | `varchar` | `"0"` |
| `findersfeeisestimate` | `varchar` | `"true"` |
| `grossproceedsisestimate` | `varchar` | `"true"` |
| `grossproceedsused` | `varchar` | `"0"` |
| `hasnonaccreditedinvestors` | `varchar` | `"false"` |
| `industrygrouptype` | `varchar` | `"Pharmaceuticals"` |
| `investmentfundtype` | `varchar` | `"Private Equity Fund"` |
| `is40act` | `varchar` | `"false"` |
| `isamendment` | `varchar` | `"false"` |
| `isbusinesscombinationtransaction` | `varchar` | `"false"` |
| `isdebttype` | `varchar` | `"true"` |
| `isequitytype` | `varchar` | `"true"` |
| `ismineralpropertytype` | `varchar` | `null` |
| `isoptiontoacquiretype` | `varchar` | `null` |
| `isothertype` | `varchar` | `null` |
| `ispooledinvestmentfundtype` | `varchar` | `"true"` |
| `issecuritytobeacquiredtype` | `varchar` | `null` |
| `istenantincommontype` | `varchar` | `null` |
| `issuerphonenumber` | `varchar` | `"434-220-0718"` |
| `issuerpreviousname` | `varchar` | `"None"` |
| `jurisdictionofinc` | `varchar` | `"VIRGINIA"` |
| `minimuminvestmentaccepted` | `varchar` | `"55000"` |
| `morethanoneyear` | `varchar` | `"false"` |
| `nameofsigner` | `varchar` | `"David G. Kalergis"` |
| `numbernonaccreditedinvestors` | `varchar` | `"1"` |
| `offeringsalesclarification` | `varchar` | `"Total Offering Amount is the aggregate of the Issuer and Oppenheimer Global Resource Private Equity Fund I, L.P., which are being offered sumultaneously. The Total Amount Sold is of the Issuer only."` |
| `previousaccessionnumber` | `varchar` | `"0001171623-15-000003"` |
| `primaryissuercik` | `varchar` | `"0001171623"` |
| `primaryissuerentityname` | `varchar` | `"DIFFUSION PHARMACEUTICALS LLC"` |
| `primaryissuerentitytype` | `varchar` | `"Limited Liability Company"` |
| `primaryissuerentitytypeotherdesc` | `varchar` | `null` |
| `revenuerange` | `varchar` | `"Decline to Disclose"` |
| `salescommissionsclarification` | `varchar` | `"Financial advisers of individual investors may charge up to 3% of the amount committed by the investor. Not all investors will be charged such a commission. Any such sales commission is not an exp...` |
| `salescommissionsdollaramount` | `varchar` | `"0"` |
| `salescommissionsisestimate` | `varchar` | `"true"` |
| `schemaversion` | `varchar` | `"X0707"` |
| `signaturedate` | `varchar` | `"2006-06-21"` |
| `signatureissuername` | `varchar` | `"DIFFUSION PHARMACEUTICALS LLC"` |
| `signaturename` | `varchar` | `"/s/ David G. Kalergis"` |
| `signaturetitle` | `varchar` | `"Chief Executive Officer"` |
| `stateorcountry` | `varchar` | `"VA"` |
| `stateorcountrydescription` | `varchar` | `"VIRGINIA"` |
| `street1` | `varchar` | `"2020 AVON COURT, #4"` |
| `street2` | `varchar` | `"Suite 111"` |
| `submissiontype` | `varchar` | `"D"` |
| `testorlive` | `varchar` | `"LIVE"` |
| `totalamountsold` | `varchar` | `"1029908"` |
| `totalnumberalreadyinvested` | `varchar` | `"15"` |
| `totalofferingamount` | `varchar` | `"1512500"` |
| `totalremaining` | `varchar` | `"482592"` |
| `useofproceedsclarification` | `varchar` | `"Named persons may be indirect beneficiaries of collateral purchases and residuals from early termination of sinking fund."` |
| `yearofincoverfiveyears` | `varchar` | `"true"` |
| `yearofincvalue` | `varchar` | `"2007"` |
| `yearofincwithinfiveyears` | `varchar` | `"true"` |
| `yearofincyettobeformed` | `varchar` | `null` |
| `zipcode` | `varchar` | `"22902"` |

### d_issuer

document_types: `D`, `D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `144535708000001` |
| `filingdate` | `varchar` | `"2008-09-25"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-09-25/d_issuer/000144535708000001.parquet"` |
| `_table` | `varchar` | `"d_issuer"` |
| `cik` | `varchar` | `"0001446213"` |
| `city` | `varchar` | `"DENVER"` |
| `edgarpreviousname` | `varchar` | `"None"` |
| `entityname` | `varchar` | `"Mortgage Opportunity Fund VII Series A, L.P."` |
| `entitytype` | `varchar` | `"Limited Partnership"` |
| `entitytypeotherdesc` | `varchar` | `null` |
| `issuerphonenumber` | `varchar` | `"303-308-6400"` |
| `issuerpreviousname` | `varchar` | `"None"` |
| `jurisdictionofinc` | `varchar` | `"DE"` |
| `stateorcountry` | `varchar` | `"CO"` |
| `stateorcountrydescription` | `varchar` | `null` |
| `street1` | `varchar` | `"1200 17TH STREET"` |
| `street2` | `varchar` | `"SUITE 880"` |
| `yearofincoverfiveyears` | `varchar` | `"true"` |
| `yearofincvalue` | `varchar` | `"2008"` |
| `yearofincwithinfiveyears` | `varchar` | `"true"` |
| `yearofincyettobeformed` | `varchar` | `"true"` |
| `zipcode` | `varchar` | `"80202"` |

### d_related_person

document_types: `D`, `D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `191010822000002` |
| `filingdate` | `varchar` | `"2022-03-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-03-29/d_related_person/000191010822000002.parquet"` |
| `_table` | `varchar` | `"d_related_person"` |
| `city` | `varchar` | `"Southlake"` |
| `firstname` | `varchar` | `"Daniel"` |
| `lastname` | `varchar` | `"Meader"` |
| `middlename` | `varchar` | `"F."` |
| `relationship` | `varchar` | `"Executive Officer"` |
| `relationshipclarification` | `varchar` | `"Manager of Manager of Issuer"` |
| `stateorcountry` | `varchar` | `"TX"` |
| `stateorcountrydescription` | `varchar` | `"TEXAS"` |
| `street1` | `varchar` | `"925 S. Kimball Avenue"` |
| `street2` | `varchar` | `"Suite 100"` |
| `zipcode` | `varchar` | `"76092"` |

### d_sales_compensation_recipient

document_types: `D`, `D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `147739909000001` |
| `filingdate` | `varchar` | `"2008-01-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-01-02/d_sales_compensation_recipient/000147739909000001.parquet"` |
| `_table` | `varchar` | `"d_sales_compensation_recipient"` |
| `associatedbdcrdnumber` | `varchar` | `"None"` |
| `associatedbdname` | `varchar` | `"NBC Securities, Inc."` |
| `city` | `varchar` | `"Birmingham"` |
| `foreignsolicitation` | `varchar` | `null` |
| `recipientcrdnumber` | `varchar` | `"None"` |
| `recipientname` | `varchar` | `"CSA Biotechnology Fund II, LLC"` |
| `solicitationdescription` | `varchar` | `null` |
| `solicitationstate` | `varchar` | `"AL\|CA\|GA\|MS\|TN\|TX\|VA\|WI"` |
| `solicitationvalue` | `varchar` | `"All States"` |
| `stateorcountry` | `varchar` | `"AL"` |
| `stateorcountrydescription` | `varchar` | `null` |
| `street1` | `varchar` | `"1927 1st Avenue North"` |
| `street2` | `varchar` | `"# 700"` |
| `zipcode` | `varchar` | `"35203"` |

### dos

document_types: `DOS`, `DOS/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114420415038150` |
| `filingdate` | `varchar` | `"2015-06-19"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-06-19/dos/000114420415038150.parquet"` |
| `_table` | `varchar` | `"dos"` |
| `accountspayable` | `varchar` | `"0.00"` |
| `accountsreceivable` | `varchar` | `"1000.00"` |
| `aggregateconsiderationbasis` | `varchar` | `"same as above"` |
| `auditorfees` | `varchar` | `"20000.00"` |
| `auditorserviceprovidername` | `varchar` | `"McGladrey LLP"` |
| `blueskyfees` | `varchar` | `"50000.00"` |
| `blueskyserviceprovidername` | `varchar` | `"INTERNAL OUT-OF -POCKET EXPENSES(1)"` |
| `brokerdealercrdnumber` | `varchar` | `"0"` |
| `cashequivalents` | `varchar` | `"0.00"` |
| `certifyifbadactor` | `varchar` | `"false"` |
| `certifyifnotdisqualified` | `varchar` | `"true"` |
| `certifyiftrue` | `varchar` | `"true"` |
| `cik` | `varchar` | `"0001645583"` |
| `city` | `varchar` | `"Washington"` |
| `clarificationresponses` | `varchar` | `"Not Applicable"` |
| `commoncusipequity` | `varchar` | `"N/A"` |
| `commonequityclassname` | `varchar` | `"Common Shares"` |
| `concurrentofferingaggregate` | `varchar` | `"0.00"` |
| `connectionname` | `varchar` | `"Benjamin S. Miller"` |
| `costandexpensesappltorevenues` | `varchar` | `"0.00"` |
| `cusipdebtsecurities` | `varchar` | `"N/A"` |
| `dealersjurisdictionsecuritiesoffering` | `varchar` | `"AL\|AK\|AZ\|AR\|CA\|CO\|CT\|DE\|DC\|FL\|GA\|HI\|ID\|IL\|IN\|IA\|KS\|KY\|LA\|ME\|MD\|MA\|MI\|MN\|MS\|MO\|MT\|NE\|NV\|NH\|NJ\|NM\|NY\|NC\|ND\|OH\|OK\|OR\|PA\|PR\|RI\|SC\|SD\|TN\|TX\|UT\|VT\|VA\|WA\|WV\|WI\|WY\|A0\|A1\|A2\|A3\|A4\|A5\|A6\|A7\|A8\|A9\|B0\|Z4"` |
| `debtsecuritiesclassname` | `varchar` | `"N/A"` |
| `deposits` | `varchar` | `"472161000.00"` |
| `depreciationandamortization` | `varchar` | `"0.00"` |
| `earningspersharebasic` | `varchar` | `"0.00"` |
| `earningspersharediluted` | `varchar` | `"0.00"` |
| `estimatednetamount` | `varchar` | `"49500000.00"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001645583"` |
| `financialstatementauditstatus` | `varchar` | `"Audited"` |
| `finderfeesfee` | `varchar` | `"0.00"` |
| `findersfeesserviceprovidername` | `varchar` | `"None"` |
| `fulltimeemployees` | `varchar` | `"0"` |
| `ifunregisterednone` | `varchar` | `"false"` |
| `indicatetier1tier2offering` | `varchar` | `"Tier2"` |
| `industrygroup` | `varchar` | `"Other"` |
| `investmentsecurities` | `varchar` | `"0.00"` |
| `irsnum` | `varchar` | `"32-0467957"` |
| `issuejurisdictionsecuritiesoffering` | `varchar` | `"AL\|AK\|AZ\|AR\|CA\|CO\|CT\|DE\|DC\|FL\|GA\|HI\|ID\|IL\|IN\|IA\|KS\|KY\|LA\|ME\|MD\|MA\|MI\|MN\|MS\|MO\|MT\|NE\|NV\|NH\|NJ\|NM\|NY\|NC\|ND\|OH\|OK\|OR\|PA\|PR\|RI\|SC\|SD\|TN\|TX\|UT\|VT\|VA\|WA\|WV\|WI\|WY"` |
| `issueraggregateoffering` | `varchar` | `"50000000.00"` |
| `issuername` | `varchar` | `"FUNDRISE REAL ESTATE INVESTMENT TRUST, LLC"` |
| `jurisdictionorganization` | `varchar` | `"DE"` |
| `jurisdictionsofsecofferednone` | `varchar` | `"true"` |
| `jurisdictionsofsecofferedsame` | `varchar` | `"false"` |
| `legalfees` | `varchar` | `"275000.00"` |
| `legalserviceprovidername` | `varchar` | `"Goodwin Procter LLP"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `loans` | `varchar` | `"425562000.00"` |
| `longtermdebt` | `varchar` | `"0.00"` |
| `nameauditor` | `varchar` | `"McGladrey LLP"` |
| `netincome` | `varchar` | `"0.00"` |
| `offerdelayedcontinuousflag` | `varchar` | `"Y"` |
| `offeringafterqualifflag` | `varchar` | `"N"` |
| `offeringbesteffortsflag` | `varchar` | `"Y"` |
| `offeringyearflag` | `varchar` | `"Y"` |
| `outstandingcommonequity` | `varchar` | `"100"` |
| `outstandingdebtsecurities` | `varchar` | `"0"` |
| `outstandingpreferredequity` | `varchar` | `"0"` |
| `outstandingsecurities` | `varchar` | `"100"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `parttimeemployees` | `varchar` | `"0"` |
| `phonenumber` | `varchar` | `"202-584-0550"` |
| `preferredcusipequity` | `varchar` | `"N/A"` |
| `preferredequityclassname` | `varchar` | `"N/A"` |
| `pricepersecurity` | `varchar` | `"10.00"` |
| `promotersfees` | `varchar` | `"0.00"` |
| `promotersserviceprovidername` | `varchar` | `"Rise Companies Corp"` |
| `propertyandequipment` | `varchar` | `"10461000.00"` |
| `propertyplantequipment` | `varchar` | `"0.00"` |
| `publiclytradedcommonequity` | `varchar` | `"N/A"` |
| `publiclytradeddebtsecurities` | `varchar` | `"N/A"` |
| `publiclytradedpreferredequity` | `varchar` | `"N/A"` |
| `qualificationofferingaggregate` | `varchar` | `"0.00"` |
| `resalesecuritiesaffiliatesflag` | `varchar` | `"N"` |
| `returncopyflag` | `varchar` | `"false"` |
| `salescommissionsserviceproviderfees` | `varchar` | `"0.00"` |
| `salescommissionsserviceprovidername` | `varchar` | `"None"` |
| `securitiesactexemption` | `varchar` | `"Rise Companies Corp. has purchased 100 common shares for a purchase price of $1,000 in a private offering. Such issuance was exempt from the registration requirements of the Securities Act pursuan...` |
| `securitiesissuedaggregateamount` | `varchar` | `"$1,000 ($10.00 per common share)"` |
| `securitiesissuedtotalamount` | `varchar` | `"100"` |
| `securitiesissuername` | `varchar` | `"Fundrise Real Estate Investment Trust, LLC"` |
| `securitiesissuertitle` | `varchar` | `"Common Shares"` |
| `securitiesoffered` | `varchar` | `"5000000"` |
| `securitiesofferedotherdesc` | `varchar` | `null` |
| `securitiesofferedtypes` | `varchar` | `"Equity (common or preferred stock)"` |
| `securitiesprincipalholderamount` | `varchar` | `"100"` |
| `securityholderaggregate` | `varchar` | `"0.00"` |
| `siccode` | `varchar` | `"6798"` |
| `sincelastfiling` | `varchar` | `"false"` |
| `solicitationproposedofferingflag` | `varchar` | `"N"` |
| `stateorcountry` | `varchar` | `"DC"` |
| `street1` | `varchar` | `"1519 Connecticut Avenue, NW, Suite 200"` |
| `street2` | `varchar` | `"1985 Cedar Bridge Avenue, Suite 1"` |
| `submissiontype` | `varchar` | `"DOS"` |
| `totalaggregateoffering` | `varchar` | `"50000000.00"` |
| `totalassets` | `varchar` | `"1000.00"` |
| `totalinterestexpenses` | `varchar` | `"2032000.00"` |
| `totalinterestincome` | `varchar` | `"22360000.00"` |
| `totalliabilities` | `varchar` | `"0.00"` |
| `totalliabilitiesandequity` | `varchar` | `"1000.00"` |
| `totalrevenues` | `varchar` | `"0.00"` |
| `totalstockholderequity` | `varchar` | `"1000.00"` |
| `underwritersfees` | `varchar` | `"750000.00"` |
| `underwritersserviceprovidername` | `varchar` | `"Bulletproof Brands Co Inc"` |
| `yearincorporation` | `varchar` | `"2015"` |
| `zipcode` | `varchar` | `"20036"` |

### effect

document_types: `EFFECT`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `999999999506000017` |
| `filingdate` | `varchar` | `"2006-05-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2006-05-22/effect/999999999506000017.parquet"` |
| `_table` | `varchar` | `"effect"` |
| `act` | `varchar` | `"33"` |
| `cik` | `varchar` | `"0000315293"` |
| `entityname` | `varchar` | `"AON CORP"` |
| `filenumber` | `varchar` | `"333-102799"` |
| `finaleffectivenessdispdate` | `varchar` | `"2006-05-22"` |
| `finaleffectivenessdisptime` | `varchar` | `null` |
| `form` | `varchar` | `"S-3"` |
| `submissiontype` | `varchar` | `"EFFECT\|POS AM"` |
| `testorlive` | `varchar` | `"LIVE"` |

### effect_merger

document_types: `EFFECT`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `999999999506000048` |
| `filingdate` | `varchar` | `"2006-05-24"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2006-05-24/effect_merger/999999999506000048.parquet"` |
| `_table` | `varchar` | `"effect_merger"` |
| `acquiringcik` | `varchar` | `null` |
| `acquiringclasscontractid` | `varchar` | `null` |
| `acquiringclasscontractname` | `varchar` | `null` |
| `acquiringentityname` | `varchar` | `null` |
| `acquiringseriesid` | `varchar` | `null` |
| `acquiringseriesname` | `varchar` | `null` |
| `targetcik` | `varchar` | `null` |
| `targetclasscontractid` | `varchar` | `"C000002462"` |
| `targetclasscontractname` | `varchar` | `"LEUTHOLD CORE INVESTMENT FUND-Retail Class"` |
| `targetentityname` | `varchar` | `null` |
| `targetseriesid` | `varchar` | `"S000000847"` |
| `targetseriesname` | `varchar` | `"LEUTHOLD CORE INVESTMENT FUND"` |

### ex_102

document_types: `EX-102`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `172137219000012` |
| `filingdate` | `varchar` | `"2019-03-20"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-03-20/ex_102/000172137219000012.parquet"` |
| `_table` | `varchar` | `"ex_102"` |
| `armindexratepercentage` | `varchar` | `null` |
| `armmarginnumber` | `varchar` | `null` |
| `assetaddedindicator` | `varchar` | `"false"` |
| `assetnumber` | `varchar` | `"070693042685"` |
| `assetsubjectdemandindicator` | `varchar` | `"false"` |
| `assettypenumber` | `varchar` | `"Ford Credit"` |
| `balloonindicator` | `varchar` | `null` |
| `debtservicecoveragesecuritizationcode` | `varchar` | `null` |
| `defeasanceoptionstartdate` | `varchar` | `null` |
| `defeasedstatuscode` | `varchar` | `null` |
| `deferredinterestcollectedamount` | `varchar` | `null` |
| `deferredinterestcumulativeamount` | `varchar` | `null` |
| `dscnetcashflowsecuritizationpercentage` | `varchar` | `null` |
| `dscnetoperatingincomesecuritizationpercentage` | `varchar` | `null` |
| `financialssecuritizationdate` | `varchar` | `null` |
| `firstloanpaymentduedate` | `varchar` | `null` |
| `gracedaysallowednumber` | `varchar` | `null` |
| `groupid` | `varchar` | `null` |
| `hyperamortizingdate` | `varchar` | `null` |
| `indexlookbackdaysnumber` | `varchar` | `null` |
| `interestaccrualmethodcode` | `varchar` | `null` |
| `interestonlyindicator` | `varchar` | `null` |
| `interestratesecuritizationpercentage` | `varchar` | `null` |
| `largesttenant` | `varchar` | `null` |
| `lastmodificationdate` | `varchar` | `null` |
| `leaseexpirationlargesttenantdate` | `varchar` | `null` |
| `leaseexpirationsecondlargesttenantdate` | `varchar` | `null` |
| `leaseexpirationthirdlargesttenantdate` | `varchar` | `null` |
| `lienpositionsecuritizationcode` | `varchar` | `null` |
| `lifetimeratecappercentage` | `varchar` | `null` |
| `lifetimeratefloorpercentage` | `varchar` | `null` |
| `liquidationprepaymentcode` | `varchar` | `null` |
| `liquidationprepaymentdate` | `varchar` | `null` |
| `loanstructurecode` | `varchar` | `null` |
| `maturitydate` | `varchar` | `null` |
| `maxnegamortamount` | `varchar` | `null` |
| `maxnegamortpercentage` | `varchar` | `null` |
| `modificationcode` | `varchar` | `null` |
| `modifiedindicator` | `varchar` | `null` |
| `mostrecentannualleaserolloverreviewdate` | `varchar` | `null` |
| `mostrecentdebtserviceamount` | `varchar` | `null` |
| `mostrecentdebtservicecoveragecode` | `varchar` | `null` |
| `mostrecentdscnetcashflowpercentage` | `varchar` | `null` |
| `mostrecentdscnetoperatingincomepercentage` | `varchar` | `null` |
| `mostrecentfinancialsenddate` | `varchar` | `null` |
| `mostrecentfinancialsstartdate` | `varchar` | `null` |
| `mostrecentmasterservicerreturndate` | `varchar` | `null` |
| `mostrecentnetcashflowamount` | `varchar` | `null` |
| `mostrecentnetoperatingincomeamount` | `varchar` | `null` |
| `mostrecentphysicaloccupancypercentage` | `varchar` | `null` |
| `mostrecentrevenueamount` | `varchar` | `null` |
| `mostrecentspecialservicertransferdate` | `varchar` | `null` |
| `mostrecentvaluationamount` | `varchar` | `null` |
| `mostrecentvaluationdate` | `varchar` | `null` |
| `mostrecentvaluationsourcecode` | `varchar` | `null` |
| `negamortdeferredinterestcapamount` | `varchar` | `null` |
| `negativeamortizationindicator` | `varchar` | `null` |
| `netcashflowsecuritizationamount` | `varchar` | `null` |
| `netoperatingincomenetcashflowcode` | `varchar` | `null` |
| `netoperatingincomenetcashflowsecuritizationcode` | `varchar` | `null` |
| `netoperatingincomesecuritizationamount` | `varchar` | `null` |
| `netrentablesquarefeetnumber` | `varchar` | `null` |
| `netrentablesquarefeetsecuritizationnumber` | `varchar` | `null` |
| `nextinterestratechangeadjustmentdate` | `varchar` | `null` |
| `nextinterestratepercentage` | `varchar` | `"0.00000000"` |
| `nonrecoverabilityindicator` | `varchar` | `null` |
| `numberproperties` | `varchar` | `null` |
| `numberpropertiessecuritization` | `varchar` | `null` |
| `operatingexpensesamount` | `varchar` | `null` |
| `operatingexpensessecuritizationamount` | `varchar` | `null` |
| `originalamortizationtermnumber` | `varchar` | `null` |
| `originalinterestonlytermnumber` | `varchar` | `null` |
| `originalinterestratepercentage` | `varchar` | `"0.00000000"` |
| `originalinterestratetypecode` | `varchar` | `"1"` |
| `originalloanamount` | `varchar` | `"18970.75000000"` |
| `originaltermloannumber` | `varchar` | `"37"` |
| `originationdate` | `varchar` | `"02/2017"` |
| `originatorname` | `varchar` | `"Ford Credit"` |
| `otherexpensesadvancedoutstandingamount` | `varchar` | `null` |
| `otherinterestadjustmentamount` | `varchar` | `null` |
| `otherprincipaladjustmentamount` | `varchar` | `"0.00000000"` |
| `paidthroughdate` | `varchar` | `null` |
| `paymentfrequencycode` | `varchar` | `null` |
| `paymentstatusloancode` | `varchar` | `null` |
| `paymenttypecode` | `varchar` | `"2"` |
| `periodicpipaymentsecuritizationamount` | `varchar` | `null` |
| `periodicpaymentadjustmentmaximumamount` | `varchar` | `null` |
| `periodicpaymentadjustmentmaximumpercent` | `varchar` | `null` |
| `periodicratedecreaselimitpercentage` | `varchar` | `null` |
| `periodicrateincreaselimitpercentage` | `varchar` | `null` |
| `physicaloccupancysecuritizationpercentage` | `varchar` | `null` |
| `postmodificationamortizationperiodamount` | `varchar` | `null` |
| `postmodificationinterestpercentage` | `varchar` | `null` |
| `postmodificationmaturitydate` | `varchar` | `null` |
| `postmodificationpaymentamount` | `varchar` | `null` |
| `prepaymentlockoutenddate` | `varchar` | `null` |
| `prepaymentpremiumindicator` | `varchar` | `null` |
| `prepaymentpremiumyieldmaintenancereceivedamount` | `varchar` | `null` |
| `prepaymentpremiumsenddate` | `varchar` | `null` |
| `primaryservicername` | `varchar` | `"Ford Credit"` |
| `propertyaddress` | `varchar` | `null` |
| `propertycity` | `varchar` | `null` |
| `propertycounty` | `varchar` | `null` |
| `propertyname` | `varchar` | `null` |
| `propertystate` | `varchar` | `null` |
| `propertystatuscode` | `varchar` | `null` |
| `propertytypecode` | `varchar` | `null` |
| `propertyzip` | `varchar` | `null` |
| `realizedlosstotrustamount` | `varchar` | `null` |
| `reportperiodbeginningscheduleloanbalanceamount` | `varchar` | `null` |
| `reportperiodendactualbalanceamount` | `varchar` | `null` |
| `reportperiodendscheduledloanbalanceamount` | `varchar` | `null` |
| `reportperiodinterestratepercentage` | `varchar` | `null` |
| `reportperiodmodificationindicator` | `varchar` | `null` |
| `reportingperiodbeginningdate` | `varchar` | `"02-01-2019"` |
| `reportingperiodenddate` | `varchar` | `null` |
| `repurchaseamount` | `varchar` | `null` |
| `revenuesecuritizationamount` | `varchar` | `null` |
| `scheduledinterestamount` | `varchar` | `"0.00"` |
| `scheduledprincipalamount` | `varchar` | `"316.18000000"` |
| `scheduledprincipalbalancesecuritizationamount` | `varchar` | `null` |
| `secondlargesttenant` | `varchar` | `null` |
| `servicertrusteefeeratepercentage` | `varchar` | `"0.01"` |
| `servicingadvancemethodcode` | `varchar` | `"1"` |
| `squarefeetlargesttenantnumber` | `varchar` | `null` |
| `squarefeetsecondlargesttenantnumber` | `varchar` | `null` |
| `squarefeetthirdlargesttenantnumber` | `varchar` | `null` |
| `thirdlargesttenant` | `varchar` | `null` |
| `totalpiadvancedoutstandingamount` | `varchar` | `null` |
| `totalscheduledpiamount` | `varchar` | `null` |
| `totaltaxesinsuranceadvancesoutstandingamount` | `varchar` | `null` |
| `underwritingindicator` | `varchar` | `"true"` |
| `unitsbedsroomsnumber` | `varchar` | `null` |
| `unitsbedsroomssecuritizationnumber` | `varchar` | `null` |
| `unscheduledprincipalcollectedamount` | `varchar` | `"500.00000000"` |
| `valuationsecuritizationamount` | `varchar` | `null` |
| `valuationsecuritizationdate` | `varchar` | `null` |
| `valuationsourcesecuritizationcode` | `varchar` | `null` |
| `workoutstrategycode` | `varchar` | `null` |
| `yearbuiltnumber` | `varchar` | `null` |
| `yearlastrenovated` | `varchar` | `null` |
| `yieldmaintenanceenddate` | `varchar` | `null` |

### ex_103

document_types: `EX-103`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `153949716004112` |
| `filingdate` | `varchar` | `"2016-11-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-11-29/ex_103/000153949716004112.parquet"` |
| `_table` | `varchar` | `"ex_103"` |
| `columnname` | `varchar` | `null` |
| `comment` | `varchar` | `null` |
| `commentcolumn` | `varchar` | `"Column/Field Name"` |
| `commentdescription` | `varchar` | `"Comment"` |
| `commentnumber` | `varchar` | `"Item Number"` |
| `fieldname` | `varchar` | `null` |
| `itemnumber` | `varchar` | `null` |

### form_144

document_types: `144`, `144/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `107997322001129` |
| `filingdate` | `varchar` | `"2022-09-19"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-09-19/form_144/000107997322001129.parquet"` |
| `_table` | `varchar` | `"form_144"` |
| `city` | `varchar` | `"KOWLOON"` |
| `contactemailaddress` | `varchar` | `"ronda.rasnick@gmail.com"` |
| `contactname` | `varchar` | `"Ronda Rasnick"` |
| `contactphonenumber` | `varchar` | `"303-807-9933"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001888730"` |
| `issuercik` | `varchar` | `"0000846546"` |
| `issuercontactphone` | `varchar` | `"01185226055822"` |
| `issuername` | `varchar` | `"BONSO ELECTRONICS INTERNATIONAL INC"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `nameofpersonforwhoseaccount` | `varchar` | `"So Andrew Chun Bong"` |
| `nothingtoreportflag` | `varchar` | `"Y"` |
| `noticedate` | `varchar` | `"09/19/2022"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `planadoptiondate` | `varchar` | `"09/21/2022"` |
| `previousaccessionnumber` | `varchar` | `"0001079973-22-000195"` |
| `relationshiptoissuer` | `varchar` | `"Director"` |
| `remarks` | `varchar` | `"1. The 845,012 shares were acquired via the conversion of a $25,000 note plus interest thereon.  The convertible note was acquired on February 10, 2022, with full cash payment of $25,000."` |
| `secfilenumber` | `varchar` | `"000-17601"` |
| `signature` | `varchar` | `"/s/ Andrew Chun Bong So"` |
| `stateorcountry` | `varchar` | `"K3"` |
| `street1` | `varchar` | `"1404 CHEUK NANG CENTRE"` |
| `street2` | `varchar` | `"9 HILLWOOD ROAD, TSIMSHATSUI"` |
| `submissiontype` | `varchar` | `"144/A"` |
| `zipcode` | `varchar` | `"000000"` |

### form_144_securities_information

document_types: `144`, `144/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `107997322001129` |
| `filingdate` | `varchar` | `"2022-09-19"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-09-19/form_144_securities_information/000107997322001129.parquet"` |
| `_table` | `varchar` | `"form_144_securities_information"` |
| `aggregatemarketvalue` | `varchar` | `"33400.00"` |
| `approxsaledate` | `varchar` | `"09/20/2022"` |
| `brokercity` | `varchar` | `"Boca Raton"` |
| `brokername` | `varchar` | `"ViewTrade Securities, Inc."` |
| `brokerstateorcountry` | `varchar` | `"FL"` |
| `brokerstreet1` | `varchar` | `"7280 W. Palmetto Park Road, #310,"` |
| `brokerstreet2` | `varchar` | `"Suite 650"` |
| `brokerzipcode` | `varchar` | `"33433"` |
| `noofunitsoutstanding` | `varchar` | `"5828205"` |
| `noofunitssold` | `varchar` | `"10000"` |
| `securitiesexchangename` | `varchar` | `"NASDAQ CAPITAL MKT"` |
| `securitiesinfoclasstitle` | `varchar` | `"Common"` |

### form_144_securities_sold

document_types: `144`, `144/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `192109422000004` |
| `filingdate` | `varchar` | `"2022-10-07"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-10-07/form_144_securities_sold/000192109422000004.parquet"` |
| `_table` | `varchar` | `"form_144_securities_sold"` |
| `amountofsecuritiessold` | `varchar` | `"3675"` |
| `city` | `varchar` | `"IRVINE"` |
| `grossproceeds` | `varchar` | `"334086.00"` |
| `saledate` | `varchar` | `"09/08/2022"` |
| `securitiesclasstitle` | `varchar` | `"EDWARDS LIFESCIENCES CORPORATION"` |
| `sellername` | `varchar` | `"HUIMIN WANG"` |
| `stateorcountry` | `varchar` | `"CA"` |
| `street1` | `varchar` | `"ONE EDWARDS WAY"` |
| `street2` | `varchar` | `null` |
| `zipcode` | `varchar` | `"92614"` |

### form_144_securities_to_be_sold

document_types: `144`, `144/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `107997322001129` |
| `filingdate` | `varchar` | `"2022-09-19"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2022-09-19/form_144_securities_to_be_sold/000107997322001129.parquet"` |
| `_table` | `varchar` | `"form_144_securities_to_be_sold"` |
| `acquireddate` | `varchar` | `"07/04/2015"` |
| `amountofsecuritiesacquired` | `varchar` | `"200000"` |
| `donaracquireddate` | `varchar` | `null` |
| `isgifttransaction` | `varchar` | `"N"` |
| `nameofpersonfromwhomacquired` | `varchar` | `"Chan Hong Ming"` |
| `natureofacquisitiontransaction` | `varchar` | `"Private Purchase"` |
| `natureofpayment` | `varchar` | `"Cash"` |
| `paymentdate` | `varchar` | `"07/04/2015"` |
| `securitiesclasstitle` | `varchar` | `"Common"` |

### information_table

document_types: `INFORMATION TABLE`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `163344526000005` |
| `filingdate` | `varchar` | `"2026-08-14"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2026-08-14/information_table/000163344526000005.parquet"` |
| `_table` | `varchar` | `"information_table"` |
| `cusip` | `varchar` | `"071705107"` |
| `figi` | `varchar` | `null` |
| `investmentdiscretion` | `varchar` | `"SOLE"` |
| `nameofissuer` | `varchar` | `"BAUSCH PLUS LOMB CORP"` |
| `othermanager` | `varchar` | `"N/A"` |
| `putcall` | `varchar` | `null` |
| `sshprnamt` | `varchar` | `"325766"` |
| `sshprnamttype` | `varchar` | `"SH"` |
| `titleofclass` | `varchar` | `"COMMON SHARES"` |
| `value` | `varchar` | `"5394685"` |
| `votingauthoritynone` | `varchar` | `"28086"` |
| `votingauthorityshared` | `varchar` | `"0"` |
| `votingauthoritysole` | `varchar` | `"297680"` |

### ma

document_types: `MA`, `MA-A`, `MA/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `130287114000006` |
| `filingdate` | `varchar` | `"2014-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-01/ma/000130287114000006.parquet"` |
| `_table` | `varchar` | `"ma"` |
| `activelyengagedprimarybusinessisactivelyengaged` | `varchar` | `null` |
| `activelyengagedprimarybusinessisprimarybusiness` | `varchar` | `null` |
| `additionaloffices` | `varchar` | `"N"` |
| `additionalregs` | `varchar` | `"N"` |
| `addressaddresscity` | `varchar` | `"Sausalito"` |
| `addressaddressstateorcountry` | `varchar` | `"NY"` |
| `addressaddressstreet1` | `varchar` | `"Tamalpais Advisors Inc."` |
| `addressaddressstreet2` | `varchar` | `"3030 Bridgeway Suite 340"` |
| `addressaddresszipcode` | `varchar` | `"94965"` |
| `addresscity` | `varchar` | `"Pittsford"` |
| `addressinfoaddresscity` | `varchar` | `"Pittsford"` |
| `addressinfoaddressstateorcountry` | `varchar` | `"NY"` |
| `addressinfoaddressstreet1` | `varchar` | `"125 Sully's Trail, Suite 4B"` |
| `addressinfoaddressstreet2` | `varchar` | `"SUITE 703"` |
| `addressinfoaddresszipcode` | `varchar` | `"14534"` |
| `addressstateorcountry` | `varchar` | `"NY"` |
| `addressstreet1` | `varchar` | `"125 Sully's Trail Suite 4B"` |
| `addressstreet2` | `varchar` | `"3030 Bridgeway Suite 340"` |
| `addresszipcode` | `varchar` | `"14534"` |
| `advbdu4filingcrdnumber` | `varchar` | `null` |
| `advbdu4filingdisclosurenumber` | `varchar` | `null` |
| `advbdu4filingname` | `varchar` | `null` |
| `affiliatename` | `varchar` | `null` |
| `allegationsdescription` | `varchar` | `null` |
| `amountordered` | `varchar` | `null` |
| `anotherregistrationdescription` | `varchar` | `"Municipal Securities Rulemaking Board"` |
| `anotherregistrationregistrationid` | `varchar` | `"K0336"` |
| `apdrpfiledcount` | `varchar` | `null` |
| `aptypenaturalpersoninfofirstname` | `varchar` | `"Archie"` |
| `aptypenaturalpersoninfolastname` | `varchar` | `"Willis"` |
| `aptypenaturalpersoninfomiddlename` | `varchar` | `"Walter"` |
| `aptypesfiaaptypes` | `varchar` | `"Other municipal advisor\|Other municipal advisor"` |
| `baseheaderapdrpfiledcount` | `varchar` | `"1"` |
| `baseinfobaseinformationcrdnumber` | `varchar` | `null` |
| `baseinfobaseinformationiscontroperson` | `varchar` | `null` |
| `baseinfobaseinformationownershipcode` | `varchar` | `null` |
| `baseinfobaseinformationstatusacquired` | `varchar` | `null` |
| `baseinfobaseinformationtitlestatus` | `varchar` | `null` |
| `baseinfocontropersonpr` | `varchar` | `null` |
| `baseinfoempidnumber` | `varchar` | `null` |
| `baseinfoirsnum` | `varchar` | `null` |
| `baseinfoname` | `varchar` | `null` |
| `baseinfonamefirstname` | `varchar` | `null` |
| `baseinfonamelastname` | `varchar` | `null` |
| `baseinfonamemiddlename` | `varchar` | `null` |
| `baseinformationbaseinfobaseinformationcrdnumber` | `varchar` | `null` |
| `baseinformationbaseinfobaseinformationiscontroperson` | `varchar` | `null` |
| `baseinformationbaseinfobaseinformationownershipcode` | `varchar` | `null` |
| `baseinformationbaseinfobaseinformationstatusacquired` | `varchar` | `null` |
| `baseinformationbaseinfobaseinformationtitlestatus` | `varchar` | `null` |
| `baseinformationbaseinfocontropersonpr` | `varchar` | `null` |
| `baseinformationbaseinfoempidnumber` | `varchar` | `null` |
| `baseinformationbaseinfoirsnum` | `varchar` | `null` |
| `baseinformationbaseinfoname` | `varchar` | `null` |
| `baseinformationbaseinfonamefirstname` | `varchar` | `null` |
| `baseinformationbaseinfonamelastname` | `varchar` | `null` |
| `baseinformationbaseinfonamemiddlename` | `varchar` | `null` |
| `baseinformationbaseinformationcrdnumber` | `varchar` | `null` |
| `baseinformationbaseinformationiscontroperson` | `varchar` | `null` |
| `baseinformationbaseinformationownershipcode` | `varchar` | `null` |
| `baseinformationbaseinformationstatusacquired` | `varchar` | `null` |
| `baseinformationbaseinformationtitlestatus` | `varchar` | `null` |
| `baseinformationchargesbroughtinaddresscity` | `varchar` | `"Washington"` |
| `baseinformationchargesbroughtinaddressstateorcountry` | `varchar` | `"DC"` |
| `baseinformationchargesbroughtinaddressstreet1` | `varchar` | `"100 F Street NE"` |
| `baseinformationchargesbroughtinaddresszipcode` | `varchar` | `"20549"` |
| `baseinformationchargesbroughtinname` | `varchar` | `"In the Matter of J. Kenneth Alderman, et al., Admin. Proceeding File No. 3-15127"` |
| `baseinformationcontropersonpr` | `varchar` | `null` |
| `baseinformationcrdnumber` | `varchar` | `null` |
| `baseinformationempidnumber` | `varchar` | `null` |
| `baseinformationirsnum` | `varchar` | `null` |
| `baseinformationiscontroperson` | `varchar` | `"Y\|N"` |
| `baseinformationname` | `varchar` | `null` |
| `baseinformationnamefirstname` | `varchar` | `"Archie\|Pamela\|Alicia"` |
| `baseinformationnamelastname` | `varchar` | `"Willis\|Clary\|Willis"` |
| `baseinformationnamemiddlename` | `varchar` | `"Walter\|Zina\|Thompson"` |
| `baseinformationownershipcode` | `varchar` | `"E\|NA"` |
| `baseinformationowningentity` | `varchar` | `null` |
| `baseinformationstatusacquired` | `varchar` | `"06-01-2004\|06-28-2012"` |
| `baseinformationsummary` | `varchar` | `"Mr. Willis was one of eight respondents in an administrative proceeding initiated by the Securities and Exchange Commission's Division of Enforcement: In the Matter of J. Kenneth Alderman, et al.,...` |
| `baseinformationtitlestatus` | `varchar` | `"CEO, CCO, AML CO\|FINOP / CFO"` |
| `bdregistrationcrdnumber` | `varchar` | `"000132847"` |
| `bdregistrationfilenumber` | `varchar` | `"008-66643"` |
| `booksandrecordslocationcontactphonenumber` | `varchar` | `"424-229-9050"` |
| `brokerdealersisactivelyengaged` | `varchar` | `"Y"` |
| `brokerdealersisprimarybusiness` | `varchar` | `"Y"` |
| `businessirsnum` | `varchar` | `null` |
| `businessname` | `varchar` | `"Larson Consulting Services, LLC"` |
| `businesstypeadd` | `varchar` | `null` |
| `businesstypeamend` | `varchar` | `null` |
| `comptypeotherdescription` | `varchar` | `"Retainers on a monthly, quarterly or annual basis"` |
| `calyearend` | `varchar` | `null` |
| `chargesbroughtinaddresscity` | `varchar` | `null` |
| `chargesbroughtinaddressstateorcountry` | `varchar` | `null` |
| `chargesbroughtinaddressstreet1` | `varchar` | `null` |
| `chargesbroughtinaddresszipcode` | `varchar` | `null` |
| `chargesbroughtindocketorcaseno` | `varchar` | `"3-15127"` |
| `chargesbroughtinname` | `varchar` | `null` |
| `cik` | `varchar` | `null` |
| `city` | `varchar` | `"PITTSFORD"` |
| `clienttypes` | `varchar` | `"Not Applicable"` |
| `clientsservedasma` | `varchar` | `"1"` |
| `commiditytaisactivelyengaged` | `varchar` | `null` |
| `compensationtypes` | `varchar` | `"Not Applicable"` |
| `compensationtypescompensationtypes` | `varchar` | `"Fixed Fees\|Contingent Fees"` |
| `contactaddressinfoaddresscity` | `varchar` | `"Venice"` |
| `contactaddressinfoaddressstateorcountry` | `varchar` | `"CA"` |
| `contactaddressinfoaddressstreet1` | `varchar` | `"315 4th Avenue"` |
| `contactaddressinfoaddressstreet2` | `varchar` | `null` |
| `contactaddressinfoaddresszipcode` | `varchar` | `"90291"` |
| `contactemail` | `varchar` | `"DONNA.DIMARIA@TESSERACAPITAL.COM"` |
| `contactfaxnumber` | `varchar` | `"314-432-2393"` |
| `contactname` | `varchar` | `"Donna DiMaria"` |
| `contactpersonaddressaddressstateorcountry` | `varchar` | `"CA"` |
| `contactpersonemail` | `varchar` | `"jbuckley@tamadvisors.com"` |
| `contactpersonfaxnumber` | `varchar` | `"4153314479"` |
| `contactpersonphonenumber` | `varchar` | `"4153314473"` |
| `contactphonenumber` | `varchar` | `"585-203-1480"` |
| `contropersonpr` | `varchar` | `"N"` |
| `country` | `varchar` | `null` |
| `crd` | `varchar` | `null` |
| `crdnumber` | `varchar` | `"001406234"` |
| `date` | `varchar` | `"07-01-2014"` |
| `datedate` | `varchar` | `null` |
| `dateinitiateddate` | `varchar` | `null` |
| `dateoforganization` | `varchar` | `"06-13-2004"` |
| `dbaname` | `varchar` | `"ComCap Advisors, a division of Community Capital"` |
| `description` | `varchar` | `"Files not required to be kept immediately accessible\nThis is a storage facility"` |
| `detailssanctionsordered` | `varchar` | `"Y"` |
| `detailssanctionssanction` | `varchar` | `"Cease and Desist"` |
| `detailstotalamountordered` | `varchar` | `null` |
| `disclosurenumber` | `varchar` | `null` |
| `docketorcaseno` | `varchar` | `null` |
| `eatypeotherdescription` | `varchar` | `"Preparation and filing of continuing disclosure annual reports."` |
| `effectivedate` | `varchar` | `null` |
| `email` | `varchar` | `"donna.dimaria@tesseracapital.com"` |
| `empidnumber` | `varchar` | `"27-0210545"` |
| `employeesengagedinmaa` | `varchar` | `"2"` |
| `engagedactivitytype` | `varchar` | `"Solicitation Of IAB\|Solicitation Other"` |
| `engineeringisactivelyengaged` | `varchar` | `null` |
| `explanation` | `varchar` | `null` |
| `faxnumber` | `varchar` | `"888-372-7640"` |
| `ffraregistrationname` | `varchar` | `null` |
| `fiaaptypes` | `varchar` | `"Broker-dealer municipal securities dealer or government securities broker or dealer\|Investment Adviser"` |
| `fiaassociatedpersontypeadd` | `varchar` | `null` |
| `fiaassociatedpersontypeamend` | `varchar` | `null` |
| `fiaassociatedpersontypenewadd` | `varchar` | `null` |
| `filenumber` | `varchar` | `"866-00379-00"` |
| `fileddisclosureadvbdu4filingcrdnumber` | `varchar` | `null` |
| `fileddisclosureadvbdu4filingname` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filerid` | `varchar` | `"0001302871"` |
| `finalamount` | `varchar` | `null` |
| `firmcrdnumber` | `varchar` | `"000132847"` |
| `firminfo` | `varchar` | `null` |
| `firmname` | `varchar` | `"TESSERA CAPITAL PARTNERS, LLC"` |
| `firstname` | `varchar` | `"Donna"` |
| `fiscalyearend` | `varchar` | `null` |
| `foreigncountry` | `varchar` | `null` |
| `formorgotherdescription` | `varchar` | `null` |
| `hasadditionaldbanames` | `varchar` | `"N"` |
| `hasadditionalwebsites` | `varchar` | `"Y"` |
| `hasannualreceiptslessthan7million` | `varchar` | `"N"` |
| `hasapplicableregistration` | `varchar` | `null` |
| `hasbooksrecords` | `varchar` | `"N"` |
| `haschanges` | `varchar` | `null` |
| `hasdbaname` | `varchar` | `"N"` |
| `hasmatreg` | `varchar` | `"Y"` |
| `hasmailingaddress` | `varchar` | `"N"` |
| `hasnamechange` | `varchar` | `"N"` |
| `haspreviousdbaname` | `varchar` | `"N"` |
| `hasscheduleb` | `varchar` | `"N"` |
| `independentbusinessemployee` | `varchar` | `"N"` |
| `indirectbusinessesbusinesstypeadd` | `varchar` | `null` |
| `indirectbusinessesbusinesstypeamend` | `varchar` | `null` |
| `indirectpersonspersontypeadd` | `varchar` | `null` |
| `indirectpersonspersontypeamend` | `varchar` | `null` |
| `initiatedbyname` | `varchar` | `null` |
| `initiateddrpallegationsdescription` | `varchar` | `"See response to Question 13."` |
| `initiateddrpdateinitiateddate` | `varchar` | `"12-10-2012"` |
| `insuranceisactivelyengaged` | `varchar` | `null` |
| `insuranceisprimarybusiness` | `varchar` | `null` |
| `internetnotificationaddress` | `varchar` | `"DONNA.DIMARIA@TESSERACAPITAL.COM"` |
| `investmentadvisorisactivelyengaged` | `varchar` | `"Y"` |
| `investmentadvisorisprimarybusiness` | `varchar` | `"Y"` |
| `irsnum` | `varchar` | `"20-0825398"` |
| `isactivelyengaged` | `varchar` | `null` |
| `isaffiliatedotherbus` | `varchar` | `"N"` |
| `isaffiliatedwithreceiptsmorethan7million` | `varchar` | `"N"` |
| `isauthorizedtoactattorney` | `varchar` | `"N"` |
| `iscpforapplicantpolicy` | `varchar` | `"N"` |
| `iscauseofdenial` | `varchar` | `"N"` |
| `ischargedwithfelony` | `varchar` | `"N"` |
| `iscontroperson` | `varchar` | `"Y"` |
| `iscontrolorcontrolled` | `varchar` | `"N\|N"` |
| `isconvictedoffelony` | `varchar` | `"N"` |
| `isdeniedlicense` | `varchar` | `"N"` |
| `isdiscipliend` | `varchar` | `"N"` |
| `isdismissed` | `varchar` | `"N"` |
| `isengagedinothernonmaabusiness` | `varchar` | `"N"` |
| `isenjoined` | `varchar` | `"N"` |
| `isfinalorder` | `varchar` | `null` |
| `isfoundincauseofdenial` | `varchar` | `"N"` |
| `isfoundincauseofsuspension` | `varchar` | `"N"` |
| `isfoundinviolationofregulation` | `varchar` | `"N"` |
| `isfoundinviolationofrules` | `varchar` | `"N"` |
| `isfoundmadefalsestatement` | `varchar` | `"N"` |
| `isimposedpenalty` | `varchar` | `"N"` |
| `ismadefalsestatement` | `varchar` | `"N"` |
| `isnamedincivilproceeding` | `varchar` | `"N"` |
| `isorderagainst` | `varchar` | `"N"` |
| `isorderagainstactivity` | `varchar` | `"N"` |
| `isorgchargedwithfelony` | `varchar` | `"N"` |
| `isorgconvictedoffelony` | `varchar` | `"N"` |
| `isothernonmaabuisinesssprimary` | `varchar` | `"N"` |
| `isprcompanyunder1215` | `varchar` | `"N"` |
| `isprcapplicant` | `varchar` | `"N"` |
| `isprimarybusiness` | `varchar` | `null` |
| `isregisteredffra` | `varchar` | `"N"` |
| `isregisteredwithffra` | `varchar` | `"N\|N"` |
| `isregulatorycomplaint` | `varchar` | `"N"` |
| `issecregistered` | `varchar` | `null` |
| `issection12or15reportingcompany` | `varchar` | `"N"` |
| `issolepropietor` | `varchar` | `"N"` |
| `issucceedingapplicant` | `varchar` | `"N"` |
| `isunethical` | `varchar` | `"N"` |
| `isundercommoncontrol` | `varchar` | `"Y\|Y"` |
| `isviolatedregulation` | `varchar` | `"N"` |
| `issuingagencyname` | `varchar` | `null` |
| `judgement` | `varchar` | `null` |
| `lastname` | `varchar` | `"DiMaria"` |
| `lawyerslicensedjurisdictions` | `varchar` | `"Florida"` |
| `legalname` | `varchar` | `"Michael Edmonton Jones\|Andre Allen"` |
| `licensedjurisdictions` | `varchar` | `null` |
| `locationname` | `varchar` | `"Public Storage"` |
| `maregistrationfilenumber` | `varchar` | `null` |
| `maaemployeesregbd` | `varchar` | `"2"` |
| `maaregia` | `varchar` | `"2"` |
| `mactbuysellfromclients` | `varchar` | `"N"` |
| `mactbuysellrecommendtoclients` | `varchar` | `"N"` |
| `mactcompensateforreferrals` | `varchar` | `"N"` |
| `mactdiscauthbuysell` | `varchar` | `"N"` |
| `mactdiscauthbuysellasmaa` | `varchar` | `"N"` |
| `mactdiscauthdeterminebrokerdealer` | `varchar` | `"N"` |
| `mactdiscauthdeterminebrokerdealerareap` | `varchar` | `null` |
| `mactdiscauthdeterminecommissiontobrokerdealer` | `varchar` | `"N"` |
| `mactenterderivativeswithclients` | `varchar` | `"N"` |
| `mactreceivecompensationforreferrals` | `varchar` | `"Y"` |
| `mactrecommendbrokerdealertoclient` | `varchar` | `"N"` |
| `mactrecommendbrokerdealertoclientareap` | `varchar` | `"N"` |
| `mactrecommendownedinteresttoclients` | `varchar` | `"N"` |
| `mactrecommendtoclientshavingothersalesinterest` | `varchar` | `"N"` |
| `mactrecommendtoclientsserving` | `varchar` | `"N"` |
| `mailingaddressdifferent` | `varchar` | `"N"` |
| `middlename` | `varchar` | `"Barbara"` |
| `miscellaneous` | `varchar` | `"Jeffrey T Larson is an independent consultant and licensed registered representative with PMA Securities, Naperville, IL, as a FINFRA and MSRB Series 7,63,24 and 53 professional related to the AAA...` |
| `monetarysanctionsamountordered` | `varchar` | `null` |
| `monetarysanctionsfinalamount` | `varchar` | `null` |
| `monthoffiscalyearend` | `varchar` | `"December"` |
| `namefirstname` | `varchar` | `"Jean"` |
| `namelastname` | `varchar` | `"Buckley"` |
| `namemiddlename` | `varchar` | `"Marie"` |
| `naturalpersoninfofirstname` | `varchar` | `null` |
| `naturalpersoninfolastname` | `varchar` | `null` |
| `naturalpersoninfomiddlename` | `varchar` | `null` |
| `nonscheduleabccontrolpersonnaturalnamefirstname` | `varchar` | `"William"` |
| `nonscheduleabccontrolpersonnaturalnamelastname` | `varchar` | `"Euphrat"` |
| `nonscheduleabccontrolpersonnaturalnamemiddlename` | `varchar` | `"Fredrick"` |
| `nonscheduleabccontrollingpersoncontactaddressinfoaddresscity` | `varchar` | `null` |
| `nonscheduleabccontrollingpersoncontactaddressinfoaddressstateorcountry` | `varchar` | `null` |
| `nonscheduleabccontrollingpersoncontactaddressinfoaddressstreet1` | `varchar` | `null` |
| `nonscheduleabccontrollingpersoncontactaddressinfoaddressstreet2` | `varchar` | `null` |
| `nonscheduleabccontrollingpersoncontactaddressinfoaddresszipcode` | `varchar` | `null` |
| `nonscheduleabccontrollingpersoncontactfaxnumber` | `varchar` | `null` |
| `nonscheduleabccontrollingpersoncontactphonenumber` | `varchar` | `"415-929-1564"` |
| `nonscheduleabccontrollingpersondescription` | `varchar` | `"William Euphrat  owns 100% of the stock of the municipal advisor"` |
| `nonscheduleabccontrollingpersontypeadd` | `varchar` | `null` |
| `numberofadditionalwebsites` | `varchar` | `"1"` |
| `numberofemployees` | `varchar` | `"4"` |
| `numberofsolicitedme` | `varchar` | `"0"` |
| `numberofsolicitedop` | `varchar` | `"0"` |
| `numberofsolicitingfirms` | `varchar` | `"0"` |
| `officeinfoaddressinfoaddresscity` | `varchar` | `null` |
| `officeinfoaddressinfoaddressstateorcountry` | `varchar` | `null` |
| `officeinfoaddressinfoaddressstreet1` | `varchar` | `null` |
| `officeinfoaddressinfoaddressstreet2` | `varchar` | `null` |
| `officeinfoaddressinfoaddresszipcode` | `varchar` | `null` |
| `otherfinancialproductadvisoractivelyengagedprimarybusinessisactivelyengaged` | `varchar` | `null` |
| `otherfinancialproductadvisoractivelyengagedprimarybusinessisprimarybusiness` | `varchar` | `null` |
| `otherfinancialproductadvisorlicensedjurisdictions` | `varchar` | `null` |
| `othernonmaabusinessprimarydescription` | `varchar` | `"Community Capital also provides consulting services in the areas of affordable housing and economic and community development.  The firm also is a participant in real estate development projects. ...` |
| `otherregistrationcik` | `varchar` | `null` |
| `otherregistrationdescription` | `varchar` | `"866-00265-00"` |
| `otherregistrationfilenumber` | `varchar` | `null` |
| `ownershipcode` | `varchar` | `"E"` |
| `owningentity` | `varchar` | `null` |
| `personbaseinfobaseinformationiscontroperson` | `varchar` | `null` |
| `personbaseinfobaseinformationownershipcode` | `varchar` | `null` |
| `personbaseinfobaseinformationstatusacquired` | `varchar` | `null` |
| `personbaseinfobaseinformationtitlestatus` | `varchar` | `null` |
| `personbaseinformationbaseinfobaseinformationiscontroperson` | `varchar` | `null` |
| `personbaseinformationbaseinfobaseinformationownershipcode` | `varchar` | `null` |
| `personbaseinformationbaseinfobaseinformationstatusacquired` | `varchar` | `null` |
| `personbaseinformationbaseinfobaseinformationtitlestatus` | `varchar` | `null` |
| `personbaseinformationbaseinformationcrdnumber` | `varchar` | `"001273548"` |
| `personbaseinformationbaseinformationiscontroperson` | `varchar` | `"Y\|Y\|N"` |
| `personbaseinformationbaseinformationownershipcode` | `varchar` | `"C\|C\|C"` |
| `personbaseinformationbaseinformationstatusacquired` | `varchar` | `"11-05-1999\|01-06-2003\|11-05-1999"` |
| `personbaseinformationbaseinformationtitlestatus` | `varchar` | `"President\|Executive Vice President\|Secretary"` |
| `personbaseinformationcrdnumber` | `varchar` | `"001460234\|003143679"` |
| `personbaseinformationowningentity` | `varchar` | `null` |
| `personnamefirstname` | `varchar` | `"Donna\|Edward"` |
| `personnamelastname` | `varchar` | `"DiMaria\|Smith"` |
| `personnamemiddlename` | `varchar` | `"Barbara\|Merrill"` |
| `personowningentity` | `varchar` | `null` |
| `persontypeadd` | `varchar` | `null` |
| `persontypeamend` | `varchar` | `null` |
| `persontypedelete` | `varchar` | `null` |
| `persontypenewadd` | `varchar` | `null` |
| `phonenumber` | `varchar` | `"585-203-1480"` |
| `previousdbaname` | `varchar` | `null` |
| `previouslegalname` | `varchar` | `null` |
| `primarybusinessname` | `varchar` | `"Phoenix Capital Partners, LLP\|Phoenix Capital Partners, LLP"` |
| `primarywebaddress` | `varchar` | `"www.tesseracapital.com"` |
| `principalofficeaddressfaxnumber` | `varchar` | `"888-372-7640"` |
| `principalofficeaddressphonenumber` | `varchar` | `"585-203-1480"` |
| `principalproducttypesproduct` | `varchar` | `"Mutual Fund(s)"` |
| `product` | `varchar` | `null` |
| `realestateisactivelyengaged` | `varchar` | `null` |
| `receivecompensationformaafromotherclients` | `varchar` | `"N"` |
| `receivecompensationformaafromotherclientsexplanation` | `varchar` | `"We are normally paid by the provider of the investment"` |
| `registeredbrokerdealerrepsisactivelyengaged` | `varchar` | `"Y"` |
| `registeredbrokerdealerrepsisprimarybusiness` | `varchar` | `null` |
| `registrationinfocrdnumber` | `varchar` | `"002157724"` |
| `registrationinfoissecregistered` | `varchar` | `"N"` |
| `registrationnum` | `varchar` | `null` |
| `registrationnumber` | `varchar` | `null` |
| `regulatorydisclosureisfoundinviolationofregulation` | `varchar` | `"N"` |
| `reportingschedule` | `varchar` | `null` |
| `resolutioninformationdatedate` | `varchar` | `"06-13-2013"` |
| `respondingtoresponsequestion` | `varchar` | `"9-C2\|9-C4\|9-C5"` |
| `responsequestion` | `varchar` | `null` |
| `sanction` | `varchar` | `null` |
| `sanctionsordered` | `varchar` | `null` |
| `sanctionssanction` | `varchar` | `null` |
| `sanctionssoughtsanction` | `varchar` | `"Cease and Desist"` |
| `satisfied` | `varchar` | `null` |
| `secregistrationcrdnumber` | `varchar` | `null` |
| `secregistrationfilenumber` | `varchar` | `null` |
| `secregistrationnumber` | `varchar` | `null` |
| `section1215dpublicreportingcompanyname` | `varchar` | `null` |
| `signature` | `varchar` | `"Donna DIMaria"` |
| `signaturetitle` | `varchar` | `"CEO / CCO / AML CO"` |
| `signername` | `varchar` | `"Donna DiMaria"` |
| `soleproprietornamefirstname` | `varchar` | `"Joy"` |
| `soleproprietornamelastname` | `varchar` | `"Howard"` |
| `soleproprietornamemiddlename` | `varchar` | `"Arlene"` |
| `solicitationcompensationtypescomptypeotherdescription` | `varchar` | `null` |
| `solicitationpersontypes` | `varchar` | `"Public pension funds\|Local government investment pools\|State government investment pools\|Hospitals\|Colleges"` |
| `spotherdescription` | `varchar` | `"Charter Schools, Municipal Entities, Districts, Authorities"` |
| `state` | `varchar` | `"CA\|IL\|NJ\|NY\|TX"` |
| `stateorcountry` | `varchar` | `"DE"` |
| `stateregistrationcrdnumber` | `varchar` | `"000132847"` |
| `statusacquired` | `varchar` | `"05-19-2009"` |
| `street1` | `varchar` | `"125 SULLY'S TRAIL, SUITE 4B"` |
| `street2` | `varchar` | `"SUITE 703"` |
| `submissiontype` | `varchar` | `"MA"` |
| `suffix` | `varchar` | `"III"` |
| `summary` | `varchar` | `null` |
| `title` | `varchar` | `"Vice President"` |
| `titlestatus` | `varchar` | `"President"` |
| `titlestitle` | `varchar` | `"President"` |
| `totalamountordered` | `varchar` | `null` |
| `totalfiaassociatedpersons` | `varchar` | `"1"` |
| `totalnumberofsolicitedmeandop` | `varchar` | `"0"` |
| `typeadd` | `varchar` | `null` |
| `typeamend` | `varchar` | `null` |
| `typedelete` | `varchar` | `null` |
| `typenewadd` | `varchar` | `null` |
| `typesexplanation` | `varchar` | `null` |
| `typesisfinalorder` | `varchar` | `"N"` |
| `typesjudgement` | `varchar` | `"Order"` |
| `typesofclientsother` | `varchar` | `"State Agencies, Districts, Authorities, Charter Schools, Universities"` |
| `usstate` | `varchar` | `null` |
| `zipcode` | `varchar` | `"14534"` |

### ma_additional_office

document_types: `MA`, `MA-A`, `MA/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `161277414000001` |
| `filingdate` | `varchar` | `"2014-07-03"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-03/ma_additional_office/000161277414000001.parquet"` |
| `_table` | `varchar` | `"ma_additional_office"` |
| `add` | `varchar` | `null` |
| `amend` | `varchar` | `null` |
| `delete` | `varchar` | `null` |
| `newadd` | `varchar` | `null` |
| `officeinfoaddressinfoaddresscity` | `varchar` | `"Kansas City"` |
| `officeinfoaddressinfoaddressstateorcountry` | `varchar` | `"MO"` |
| `officeinfoaddressinfoaddressstreet1` | `varchar` | `"3013 Main Street"` |
| `officeinfoaddressinfoaddressstreet2` | `varchar` | `"Suite 301"` |
| `officeinfoaddressinfoaddresszipcode` | `varchar` | `"64108"` |
| `officeinfofaxnumber` | `varchar` | `"212-662-9818"` |
| `officeinfophonenumber` | `varchar` | `"512-375-3460"` |

### ma_additional_registration

document_types: `MA`, `MA-A`, `MA/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `72468314000014` |
| `filingdate` | `varchar` | `"2014-07-09"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-09/ma_additional_registration/000072468314000014.parquet"` |
| `_table` | `varchar` | `"ma_additional_registration"` |
| `nameandregistrationname` | `varchar` | `"U.S. COMMODITY FUTURES TRADING COMMISSION"` |
| `registrationid` | `varchar` | `"NFA 0001427"` |

### ma_additional_web_address

document_types: `MA`, `MA-A`, `MA/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `130287114000006` |
| `filingdate` | `varchar` | `"2014-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-01/ma_additional_web_address/000130287114000006.parquet"` |
| `_table` | `varchar` | `"ma_additional_web_address"` |
| `adddeleteamendadd` | `varchar` | `null` |
| `amend` | `varchar` | `null` |
| `delete` | `varchar` | `null` |
| `newadd` | `varchar` | `null` |
| `webaddress` | `varchar` | `"www.goalconsultinggroup.com"` |

### ma_business_conducted_other_name

document_types: `MA`, `MA-A`, `MA/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `161037014000007` |
| `filingdate` | `varchar` | `"2014-07-03"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-03/ma_business_conducted_other_name/000161037014000007.parquet"` |
| `_table` | `varchar` | `"ma_business_conducted_other_name"` |
| `amend` | `varchar` | `null` |
| `businessconductedothernameadddeleteamendadd` | `varchar` | `null` |
| `delete` | `varchar` | `null` |
| `jurisdictions` | `varchar` | `"DC"` |
| `name` | `varchar` | `"Phoenix Capital Partners, LLC"` |
| `newadd` | `varchar` | `null` |

### ma_i

document_types: `MA-I`, `MA-I/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `130287114000007` |
| `filingdate` | `varchar` | `"2014-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-01/ma_i/000130287114000007.parquet"` |
| `_table` | `varchar` | `"ma_i"` |
| `addresscity` | `varchar` | `null` |
| `addressinfocity` | `varchar` | `"Washington"` |
| `addressinfostateorcountrystateorcountry` | `varchar` | `"CT\|MA\|NY\|MA"` |
| `addressinfozipcode` | `varchar` | `"20005"` |
| `addressstateorcountry` | `varchar` | `null` |
| `addressstreet1` | `varchar` | `null` |
| `addresszipcode` | `varchar` | `null` |
| `applicantcrdnum` | `varchar` | `"001406234"` |
| `approximatehoursormonths` | `varchar` | `"32"` |
| `city` | `varchar` | `"Pittsford"` |
| `civiljudicialinitiator` | `varchar` | `null` |
| `contactemail` | `varchar` | `"DONNA.DIMARIA@TESSERACAPITAL.COM"` |
| `contactname` | `varchar` | `"Donna DiMaria"` |
| `crdnumber` | `varchar` | `"001273548"` |
| `datesigned` | `varchar` | `"07-03-2014"` |
| `dutiesdescription` | `varchar` | `"Negotiate real estate agreements"` |
| `enddate` | `varchar` | `null` |
| `explanation` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filerid` | `varchar` | `"0001302871"` |
| `filingname` | `varchar` | `null` |
| `firstname` | `varchar` | `"Donna"` |
| `hasmorethanoneadvisoryfirms` | `varchar` | `"N"` |
| `internetnotificationaddress` | `varchar` | `"DONNA.DIMARIA@TESSERACAPITAL.COM"` |
| `investigationauthorityname` | `varchar` | `null` |
| `investigationnature` | `varchar` | `null` |
| `isamendment` | `varchar` | `"N"` |
| `isassociationbared` | `varchar` | `"N"` |
| `isauthorizedtoactattorney` | `varchar` | `"N"` |
| `isbankruptcypetition` | `varchar` | `"N"` |
| `isbondrevoked` | `varchar` | `"N"` |
| `iscauseofdenial` | `varchar` | `"N"` |
| `ischargedwithfelony` | `varchar` | `"N"` |
| `ischargedwithmisdemeanor` | `varchar` | `"N"` |
| `iscomplaintpending` | `varchar` | `"N"` |
| `iscomplaintsettled` | `varchar` | `"N"` |
| `iscompromised` | `varchar` | `"N"` |
| `isconvictedoffelony` | `varchar` | `"N"` |
| `isconvictedofmisdemeanor` | `varchar` | `"N"` |
| `isdeniedlicense` | `varchar` | `"N"` |
| `isdiscipliend` | `varchar` | `"N"` |
| `isdismissed` | `varchar` | `"N"` |
| `isengagedinotherbusiness` | `varchar` | `"N"` |
| `isenjoined` | `varchar` | `"N"` |
| `isfailedresonably` | `varchar` | `"N"` |
| `isfailedtosupervise` | `varchar` | `"N"` |
| `isfinalorder` | `varchar` | `"N"` |
| `isfoundincauseofdenial` | `varchar` | `"N"` |
| `isfoundincauseofsuspension` | `varchar` | `"N"` |
| `isfoundinviolationofregulation` | `varchar` | `"N"` |
| `isfoundinviolationofrules` | `varchar` | `"N"` |
| `isfoundmadefalsestatement` | `varchar` | `"N"` |
| `isfoundwillfullyaided` | `varchar` | `"N"` |
| `isfraudcasepending` | `varchar` | `"N"` |
| `isfraudcaseresultedaward` | `varchar` | `"N"` |
| `isfraudcasesettled` | `varchar` | `"N"` |
| `isimposedpenalty` | `varchar` | `"N"` |
| `isindividual` | `varchar` | `null` |
| `isinvestigated` | `varchar` | `"N"` |
| `isinvolvedinfraud` | `varchar` | `"N"` |
| `islienagainst` | `varchar` | `"N"` |
| `ismadefalsestatement` | `varchar` | `"N"` |
| `isnamedincivilproceeding` | `varchar` | `"N"` |
| `isorderagainst` | `varchar` | `"N"` |
| `isorderagainstactivity` | `varchar` | `"N"` |
| `isorgchargedwithfelony` | `varchar` | `"N"` |
| `isorgchargedwithmisdemeanor` | `varchar` | `"N"` |
| `isorgconvictedoffelony` | `varchar` | `"N"` |
| `isorgconvictedofmisdemeanor` | `varchar` | `"N"` |
| `isregulatorycomplaint` | `varchar` | `"N"` |
| `isrelatedtoinvestment` | `varchar` | `"Y"` |
| `isrelatedtomunicipaladvisor` | `varchar` | `"Y"` |
| `istrusteeapointed` | `varchar` | `"N"` |
| `isunethical` | `varchar` | `"N"` |
| `isviloatedindustrystandard` | `varchar` | `"N"` |
| `isviolatedregulation` | `varchar` | `"N"` |
| `isviolatedsecurityact` | `varchar` | `"N"` |
| `iswillfullyaided` | `varchar` | `"N"` |
| `iswillfullyviolatedsecurityact` | `varchar` | `"N"` |
| `lastname` | `varchar` | `"DiMaria"` |
| `middlename` | `varchar` | `"Barbara"` |
| `name` | `varchar` | `"Tessera Capital Partners, LLC"` |
| `nameofapplicantfirstname` | `varchar` | `"Robert"` |
| `nameofapplicantlastname` | `varchar` | `"Ward"` |
| `nameofapplicantmiddlename` | `varchar` | `"Evan"` |
| `natureofbusiness` | `varchar` | `"Real Estate Development"` |
| `noofadvisoryfirms` | `varchar` | `"1"` |
| `otherbusinessisrelatedtoinvestment` | `varchar` | `"N"` |
| `otherbusinessisrelatedtomunicipaladvisor` | `varchar` | `"N"` |
| `otherbusinessname` | `varchar` | `"Triden Development Group, LLC"` |
| `otherbusinesspositiondescription` | `varchar` | `"Principal"` |
| `otherbusinessstartdate` | `varchar` | `"11-2004"` |
| `phonenumber` | `varchar` | `"585-203-1480"` |
| `positiondescription` | `varchar` | `"CEO / CCO / AML CO"` |
| `prioremployeraddressinfocity` | `varchar` | `"Fairfield\|Marblehead\|New York\|Boston"` |
| `prioremployeraddressinfozipcode` | `varchar` | `"06824\|01945\|10022\|02190"` |
| `prioremployerenddate` | `varchar` | `"10-2010\|04-2009\|10-2008\|07-2006"` |
| `prioremployerisrelatedtoinvestment` | `varchar` | `"Y\|N\|Y\|Y"` |
| `prioremployerisrelatedtomunicipaladvisor` | `varchar` | `"N\|N\|N\|N"` |
| `prioremployername` | `varchar` | `"Herbert J. Sims\|Retired\|Superderivatives\|Moors & Cabot"` |
| `prioremployerpositiondescription` | `varchar` | `"Managing Director\|Retired\|Global Head of Corporate and Strategic Development\|Managing Director"` |
| `prioremployerstartdate` | `varchar` | `"04-2009\|10-2008\|07-2006\|10-2003"` |
| `regulatorydisclosurecommonquestionisfoundinviolationofregulation` | `varchar` | `"N"` |
| `regulatoryquestions` | `varchar` | `null` |
| `signature` | `varchar` | `"Robert Evan Ward"` |
| `signaturedatesigned` | `varchar` | `"07-01-2014"` |
| `signaturesignature` | `varchar` | `"Donna DiMaria"` |
| `startdate` | `varchar` | `"03-2004"` |
| `stateorcountry` | `varchar` | `"DC"` |
| `stateorcountrystateorcountry` | `varchar` | `"NY"` |
| `street1` | `varchar` | `"700 12th Street NW Suite 700"` |
| `street2` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"MA-I"` |
| `suffix` | `varchar` | `null` |
| `terminationdisclosureisfailedtosupervise` | `varchar` | `"N"` |
| `terminationfirmcrdnumber` | `varchar` | `null` |
| `title` | `varchar` | `"CEO / CCO / AML CO"` |
| `zipcode` | `varchar` | `"14534"` |

### ma_i_advisor_office

document_types: `MA-I`, `MA-I/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `130287114000007` |
| `filingdate` | `varchar` | `"2014-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-01/ma_i_advisor_office/000130287114000007.parquet"` |
| `_table` | `varchar` | `"ma_i_advisor_office"` |
| `addresscity` | `varchar` | `"PITTSFORD"` |
| `addressstateorcountry` | `varchar` | `"NY"` |
| `addressstreet1` | `varchar` | `"125 SULLY'S TRAIL, SUITE 4B"` |
| `addressstreet2` | `varchar` | `"SUITE 703"` |
| `addresszipcode` | `varchar` | `"14534"` |
| `advisorofficestartdate` | `varchar` | `"03-01-2004"` |
| `locationinfo` | `varchar` | `"LOCATED\|SUPERVISED"` |

### ma_i_municipal_advisor_office

document_types: `MA-I`, `MA-I/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `130287114000007` |
| `filingdate` | `varchar` | `"2014-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-01/ma_i_municipal_advisor_office/000130287114000007.parquet"` |
| `_table` | `varchar` | `"ma_i_municipal_advisor_office"` |
| `cik` | `varchar` | `"0001302871"` |
| `explanation` | `varchar` | `"Doing individuals (MA-1) first"` |
| `filenumber` | `varchar` | `null` |
| `isindependentrelatioship` | `varchar` | `"N"` |
| `municipaldbaname` | `varchar` | `"Not for Profit Capital Strategies"` |
| `municipalfilerfilerid` | `varchar` | `"0001302871"` |
| `municipalfirmname` | `varchar` | `"TESSERA CAPITAL PARTNERS, LLC"` |
| `recentemploymentcommenceddate` | `varchar` | `"03-01-2004"` |

### ma_i_other_name

document_types: `MA-I`, `MA-I/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `130287114000007` |
| `filingdate` | `varchar` | `"2014-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-07-01/ma_i_other_name/000130287114000007.parquet"` |
| `_table` | `varchar` | `"ma_i_other_name"` |
| `othernamefirstname` | `varchar` | `"Donna"` |
| `othernamelastname` | `varchar` | `"Assenzio"` |
| `othernamemiddlename` | `varchar` | `"Barbara"` |
| `othernamesuffix` | `varchar` | `null` |

### ma_w

document_types: `MA-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `160870614000003` |
| `filingdate` | `varchar` | `"2014-10-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-10-27/ma_w/000160870614000003.parquet"` |
| `_table` | `varchar` | `"ma_w"` |
| `city` | `varchar` | `"Baltimore"` |
| `contactemail` | `varchar` | `"faimgroupofbaltimore@msn.com"` |
| `contactphonenumber` | `varchar` | `"4432865273"` |
| `date` | `varchar` | `"10-27-2014"` |
| `email` | `varchar` | `"faimgroupofbaltimore@msn.com"` |
| `filenumber` | `varchar` | `"867-00789"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filerfilenumber` | `varchar` | `"867-00789"` |
| `filerid` | `varchar` | `"0001608706"` |
| `firstname` | `varchar` | `"Katrina"` |
| `fulllegalname` | `varchar` | `"FAIM Group Strategic Solutions Center, LLC of Baltimore"` |
| `internetnotificationaddress` | `varchar` | `"damon@colbertlegal.com"` |
| `isadvisorycontract` | `varchar` | `"N"` |
| `isborrowednotrepaid` | `varchar` | `"N"` |
| `isreceivedanyprepaidfee` | `varchar` | `"N"` |
| `isunsatisfiedjudgementsorliens` | `varchar` | `"N"` |
| `lastname` | `varchar` | `"Riddick"` |
| `middlename` | `varchar` | `"Romona"` |
| `muncipaladvisoryfirmtitle` | `varchar` | `"President and CEO"` |
| `name` | `varchar` | `"Katrina Riddick"` |
| `phonenumber` | `varchar` | `"4432865273"` |
| `signature` | `varchar` | `"Katrina R. Riddick"` |
| `signername` | `varchar` | `"Katrina R. Riddick"` |
| `soleproprietordate` | `varchar` | `null` |
| `soleproprietorsignature` | `varchar` | `null` |
| `soleproprietorsignername` | `varchar` | `null` |
| `soleproprietortitle` | `varchar` | `null` |
| `stateorcountry` | `varchar` | `"MD"` |
| `street1` | `varchar` | `"914 S Highland Avenue"` |
| `street2` | `varchar` | `"Suite 400"` |
| `submissiontype` | `varchar` | `"MA-W"` |
| `title` | `varchar` | `"President and CEO"` |
| `zipcode` | `varchar` | `"21224"` |

### ma_w_person_location

document_types: `MA-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `160870614000003` |
| `filingdate` | `varchar` | `"2014-10-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2014-10-27/ma_w_person_location/000160870614000003.parquet"` |
| `_table` | `varchar` | `"ma_w_person_location"` |
| `addresscity` | `varchar` | `"Baltimore"` |
| `addressinfoaddresscity` | `varchar` | `"Baltimore"` |
| `addressinfoaddressstateorcountry` | `varchar` | `"MD"` |
| `addressinfoaddressstreet1` | `varchar` | `"914 S. Highland Avenue"` |
| `addressinfoaddressstreet2` | `varchar` | `"Suite 201"` |
| `addressinfoaddresszipcode` | `varchar` | `"21224"` |
| `addressstateorcountry` | `varchar` | `"MD"` |
| `addressstreet1` | `varchar` | `"914 S. Highland Avenue"` |
| `addressstreet2` | `varchar` | `"Suite 201"` |
| `addresszipcode` | `varchar` | `"21224"` |
| `description` | `varchar` | `"The firm has had no municipal government or issuer clients since its inception 2010.  The firm has solely operated as a financial advisor consultant to small and start-up businesses. All records p...` |
| `nameaddressphonename` | `varchar` | `"Residence and Home Office of Katrina R. Riddick"` |
| `nameaddressphonephonenumber` | `varchar` | `"4432865273"` |
| `personinfoname` | `varchar` | `"Katrina R. Riddick"` |
| `personinfophonenumber` | `varchar` | `"4432865273"` |

### n_cen

document_types: `N-CEN`, `N-CEN/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554918005124` |
| `filingdate` | `varchar` | `"2018-09-07"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2018-09-07/n_cen/000114554918005124.parquet"` |
| `_table` | `varchar` | `"n_cen"` |
| `additionalunitstotalvalue` | `varchar` | `null` |
| `admincountry` | `varchar` | `null` |
| `adminlei` | `varchar` | `"549300CFZQLI9QNJ1Z03\|549300CFZQLI9QNJ1Z03\|549300CFZQLI9QNJ1Z03\|549300CFZQLI9QNJ1Z03"` |
| `adminname` | `varchar` | `"BNY Mellon Investment Servicing (US) Inc.\|BNY Mellon Investment Servicing (US) Inc.\|BNY Mellon Investment Servicing (US) Inc.\|BNY Mellon Investment Servicing (US) Inc."` |
| `adminother` | `varchar` | `null` |
| `adminrssdid` | `varchar` | `null` |
| `adminstate` | `varchar` | `"US-DE\|US-DE\|US-DE\|US-DE"` |
| `adminstatecountryadmincountry` | `varchar` | `"US\|US\|US\|US"` |
| `aggregatecommission` | `varchar` | `"1357880.120000000000\|824090.520000000000\|114070.930000000000\|937513.600000000000"` |
| `assetclasstype` | `varchar` | `null` |
| `assettype` | `varchar` | `null` |
| `assettypeotherdesc` | `varchar` | `null` |
| `authorizedparticipantcrdno` | `varchar` | `"000016139\|000000134\|000000816\|000007691\|000148390\|000015794\|000024962\|000116797\|000031194\|000128351\|000016139\|000015794\|000000816\|000000134\|000148390\|000116797\|000024962\|000031194\|000128351\|000007...` |
| `authorizedparticipantfileno` | `varchar` | `"008-33359\|008-00201\|008-00422\|008-07221\|008-68015\|008-32682\|008-40490\|008-53574\|008-45411\|008-66125\|008-33359\|008-32682\|008-00422\|008-00201\|008-68015\|008-53574\|008-40490\|008-45411\|008-66125\|008-07...` |
| `authorizedparticipantlei` | `varchar` | `"549300PMHS66E71I2D34\|5493004J7H4GCPG6OB62\|1V8Y6QCX6YMJ2OELII46\|8NAV47T0Y26Q87Y0QP81\|54930088MP91YZQJT494\|RCNB6OTYUAMMP879YW96\|7VHWWWW4UJS7NUM3PT30\|12UUJYTN7D3SW8KCSG25\|549300LCO2FLSSVFFR64\|549300F...` |
| `authorizedparticipantname` | `varchar` | `"Merrill Lynch Professional Clearing Corp.\|Cantor Fitzgerald & Co.\|Credit Suisse Securities (USA) LLC\|Merrill Lynch, Pierce, Fenner & Smith Inc\|Virtu Financial BD LLC\|BNP Paribas Securities Corp.\|B...` |
| `authorizedparticipantpurchasevalue` | `varchar` | `"0\|0\|0\|0\|0\|0\|0\|0\|0\|0\|28816953.52\|0\|0\|0\|0\|0\|0\|0\|0\|0\|8175049.6\|0\|0\|0\|0\|0\|0\|0\|0\|0"` |
| `authorizedparticipantredeemvalue` | `varchar` | `"891023.88\|1690928.48\|0\|0\|0\|0\|0\|0\|0\|0\|1346660.67\|0\|0\|0\|0\|0\|0\|0\|0\|0\|3938161.57\|0\|0\|0\|0\|0\|0\|0\|0\|0"` |
| `averagecreditlineused` | `varchar` | `"1224459.000000000000\|602311.000000000000\|341000.000000000000\|825705.000000000000\|1773357.000000000000\|484100.000000000000\|302526.000000000000\|654879.000000000000\|940009.000000000000"` |
| `averagepercentagepurchased` | `varchar` | `"0\|1\|1"` |
| `averagepercentageredeemed` | `varchar` | `"0.0023\|1\|1"` |
| `avgportfoliosecuritiesvalue` | `varchar` | `"158765556.000000000000\|122358484.000000000000\|6601867.400000000000\|248586189.000000000000"` |
| `booksrecordsdesc` | `varchar` | `"Records covering shareholder accounts and portfolio transactions"` |
| `brokercountry` | `varchar` | `"GB"` |
| `brokercrdno` | `varchar` | `"000002347\|000001042\|000121395\|000126292\|000001252\|000000793\|000000705\|000007654\|000001232\|000000079\|000116270\|000019714\|000002347\|000000665\|000003496\|000000793\|000007654\|000000079\|000001042\|000000...` |
| `brokerdealercommission` | `varchar` | `"0.000000000000\|0.000000000000\|0.000000000000"` |
| `brokerdealercountry` | `varchar` | `null` |
| `brokerdealercrdno` | `varchar` | `"000288524\|000285480\|000027314"` |
| `brokerdealerfileno` | `varchar` | `"8-69932\|8-69844\|8-043057"` |
| `brokerdealerlei` | `varchar` | `"N/A\|N/A\|N/A"` |
| `brokerdealername` | `varchar` | `"EIG GLOBAL ENERGY PARTNERS CAPTIAL MARKETS LLC\|Pantheon Securities, LLC\|AMG DISTRIBUTORS, INC"` |
| `brokerdealerrssdid` | `varchar` | `null` |
| `brokerdealerstate` | `varchar` | `"US-DC\|US-NY\|US-CT"` |
| `brokerdealerstatecountrybrokerdealercountry` | `varchar` | `"US\|US\|US"` |
| `brokerfileno` | `varchar` | `"008-15074\|008-12123\|008-65407\|008-65876\|008-02698\|008-01447\|008-10999\|008-22651\|008-14562\|008-35008\|008-53535\|008-41342\|008-15074\|008-15204\|008-1927\|008-01447\|008-22651\|008-35008\|008-12123\|008-301...` |
| `brokerlei` | `varchar` | `"58PU97L1C0WSRCWADL48\|549300RO3RYDN328JY68\|549300YWNPUXBR9XZW77\|VYVVCKR63DVZZN70PB21\|549300J0P7XYE8BMZ775\|5WUVMA08EYG4KEUPW589\|U4ONQX15J3RO8XCKE979\|T6FIZBDPKLYJKFCRVK44\|549300I7JYZHT7D5CO04\|ZBUT11V...` |
| `brokername` | `varchar` | `"JEFFERIES LLC\|Allen & Company LLC\|Craig-Hallum Capital Group LLC\|WELLS FARGO SECURITIES LLC\|Blair William & Company LLC\|Stifel, Nicolaus & Co., Inc.\|Raymond James & Associates, Inc.\|UBS Securities...` |
| `brokerrssdid` | `varchar` | `null` |
| `brokerstate` | `varchar` | `"US-NY\|US-NY\|US-MN\|US-NC\|US-IL\|US-MO\|US-FL\|US-NY\|US-NY\|US-NY\|US-NY\|US-NY\|US-NY\|US-MN\|US-AR\|US-MO\|US-NY\|US-NY\|US-NY\|US-OH\|US-NC\|US-NY\|US-NJ\|US-OH\|US-NY\|US-NY\|US-IL\|US-NY\|US-NY\|US-OH\|US-NY\|US-NY\|US-I...` |
| `brokerstatecountrybrokercountry` | `varchar` | `"US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US"` |
| `ccc` | `varchar` | `"XXXXXXXX"` |
| `ccocity` | `varchar` | `"Denver"` |
| `ccocountry` | `varchar` | `"US"` |
| `ccoemployerid` | `varchar` | `"N/A"` |
| `ccoemployername` | `varchar` | `"N/A"` |
| `cconame` | `varchar` | `"Rick Grove"` |
| `ccophone` | `varchar` | `"XXXXXX"` |
| `ccostate` | `varchar` | `"US-CO"` |
| `ccostreet1` | `varchar` | `"100 Fillmore Street"` |
| `ccostreet2` | `varchar` | `"Suite 325"` |
| `ccozipcode` | `varchar` | `"80206"` |
| `changeexplanation` | `varchar` | `null` |
| `cik` | `varchar` | `"0000745467"` |
| `classid` | `varchar` | `null` |
| `classinfoclassid` | `varchar` | `"C000177159\|C000177158\|C000195944"` |
| `collateralmanagerlei` | `varchar` | `"HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49"` |
| `collateralmanagername` | `varchar` | `"BNY Mellon\|BNY Mellon\|BNY Mellon\|BNY Mellon"` |
| `commonstockexchange` | `varchar` | `null` |
| `commonstocktickersymbol` | `varchar` | `null` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `contractvalueredeemed` | `varchar` | `null` |
| `contractvalueredeemedsection1035` | `varchar` | `null` |
| `coveredbyinsurancepolicyiscoveredbyinsurancepolicy` | `varchar` | `"Y"` |
| `crdnumber` | `varchar` | `"N/A"` |
| `creationunitnumofshares` | `varchar` | `"50000\|50000\|50000"` |
| `creationunitpercentageredeemedinkind` | `varchar` | `"0.9977\|0\|0"` |
| `creationunitpurchasedinkind` | `varchar` | `"0\|0\|0"` |
| `creationunitpurchasedsdinkind` | `varchar` | `"0\|0\|0"` |
| `creationunitsdredeemedinkind` | `varchar` | `"0.0017\|0\|0"` |
| `creationunittransactionfeecashmanyunits` | `varchar` | `"0\|500\|500"` |
| `creationunittransactionfeecashperunit` | `varchar` | `"0\|0\|0"` |
| `creationunittransactionfeecashpercentageperunit` | `varchar` | `"0\|0\|0"` |
| `creationunittransactionfeemanyunits` | `varchar` | `"0\|500\|500"` |
| `creationunittransactionfeeperunit` | `varchar` | `"0\|0\|0"` |
| `creationunittransactionfeepercentageperunit` | `varchar` | `"0\|0\|0"` |
| `creditinstitutionname` | `varchar` | `"The Bank of New York Mellon\|The Bank of New York Mellon\|The Bank of New York Mellon\|Bank of New York Mellon\|The Bank of New York Mellon\|The Bank of New York Mellon\|The Bank of New York Mellon\|The ...` |
| `creditlineusediscreditlineused` | `varchar` | `"Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y"` |
| `credittype` | `varchar` | `"Shared\|Shared\|Shared\|Shared\|Shared\|Shared\|Shared\|Shared\|Shared"` |
| `credituserfundname` | `varchar` | `"Omni Small-Cap Value Fund\|Omni Tax-Managed Small-Cap Value Fund\|Aggressive Investors 1 Fund\|Ultra-Small Company Market Fund\|Managed Volatility Fund\|Small-Cap Growth Fund\|Small-Cap Value Fund\|Ultra...` |
| `custodiancountry` | `varchar` | `"KR\|CL\|SG\|MX\|TR\|CO\|PE\|AU\|NZ\|IT\|HK\|CA\|CN\|SE\|CY\|HU\|MY\|ID\|CN\|AR\|IL\|BE\|KR\|BR\|CH\|GB\|PL\|ZA"` |
| `custodianlei` | `varchar` | `"HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49"` |
| `custodianname` | `varchar` | `"The Bank of New York Mellon\|The Bank of New York Mellon\|The Bank of New York Mellon\|The Bank of New York Mellon"` |
| `custodianrssdid` | `varchar` | `null` |
| `custodianstate` | `varchar` | `"US-NY\|US-NY\|US-NY\|US-NY"` |
| `custodianstatecountrycustodiancountry` | `varchar` | `"US\|US\|US\|US"` |
| `custodytype` | `varchar` | `"Bank - section 17(f)(1) (15 U.S.C. 80a-17(f)(1))\|Bank - section 17(f)(1) (15 U.S.C. 80a-17(f)(1))\|Bank - section 17(f)(1) (15 U.S.C. 80a-17(f)(1))\|Bank - section 17(f)(1) (15 U.S.C. 80a-17(f)(1))"` |
| `dailyavgnetassets` | `varchar` | `"0.000000000000\|0.000000000000\|0.000000000000\|0.000000000000"` |
| `dateofchange` | `varchar` | `null` |
| `dayscreditused` | `varchar` | `"111\|45\|7\|44\|56\|10\|19\|124\|113"` |
| `depositorcountry` | `varchar` | `null` |
| `depositorcrdno` | `varchar` | `null` |
| `depositorlei` | `varchar` | `null` |
| `depositorname` | `varchar` | `null` |
| `depositorrssdid` | `varchar` | `null` |
| `depositorstate` | `varchar` | `null` |
| `depositorultimateparentname` | `varchar` | `null` |
| `description` | `varchar` | `null` |
| `didfundlendsecurities` | `varchar` | `"N\|N"` |
| `didindemnificationrights` | `varchar` | `"N\|N\|N\|N"` |
| `directorcrdnumber` | `varchar` | `"000437190\|N/A\|006852043\|N/A\|N/A\|N/A"` |
| `directorname` | `varchar` | `"Michael Stolper\|Guy M. Arnold\|John S. Emrich, CFA\|Michael S. Erickson\|James Bernard Glavin\|Edward F. Keely, CFA"` |
| `etfseriesid` | `varchar` | `"S000059908\|S000056279\|S000056280"` |
| `familyinvcompfullname` | `varchar` | `"Fidelity Group of Funds"` |
| `feederfundname` | `varchar` | `null` |
| `filenumber` | `varchar` | `"811-03455"` |
| `filenumberinfofilenumber` | `varchar` | `"N/A\|N/A\|811-22417\|811-22417\|N/A\|N/A"` |
| `financialsupportseriesinfoisfinancialsupportduringperiod` | `varchar` | `null` |
| `foreigninvestmentsisforeignsubsidiary` | `varchar` | `"Y\|Y"` |
| `foreignsubsidiarylei` | `varchar` | `"549300QA3GJ1OGJK7J87\|549300D4ABM62PE8FE93"` |
| `foreignsubsidiaryname` | `varchar` | `"GraniteShares GSCI Cayman Limited\|GraniteShares BCOM Cayman Limited"` |
| `fundexchange` | `varchar` | `"XSEF\|XSEF\|XSEF"` |
| `fundlendsecuritiesdidfundlendsecurities` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `fundname` | `varchar` | `"GraniteShares HIPS US High Income ETF\|GraniteShares Bloomberg Commodity Broad Strategy No K-1 ETF\|GraniteShares S&P GSCI Commodity Broad Strategy No K-1 ETF"` |
| `fundtype` | `varchar` | `"N/A\|N/A\|N/A\|N/A"` |
| `fundtypesfundtype` | `varchar` | `"Money Market Fund"` |
| `fundstickersymbol` | `varchar` | `"HIPS\|COMB\|COMG"` |
| `grosscommission` | `varchar` | `"89746.080000000000\|136743.210000000000\|54136.200000000000\|40920.690000000000\|51355.290000000000\|43753.650000000000\|54481.920000000000\|48648.870000000000\|114358.800000000000\|263850.460000000000\|251...` |
| `grosspremiumreceived` | `varchar` | `null` |
| `grosspremiumreceivedsection1035` | `varchar` | `null` |
| `haslineofcredit` | `varchar` | `"N\|N\|N\|N"` |
| `idnumberdesc` | `varchar` | `"SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number"` |
| `idemnityproviderlei` | `varchar` | `"HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49"` |
| `idemnityprovidername` | `varchar` | `"BNY Mellon\|BNY Mellon\|BNY Mellon\|BNY Mellon"` |
| `idemnityproviderrssdid` | `varchar` | `null` |
| `includeallclassesflag` | `varchar` | `"true"` |
| `indexfundinfofundtype` | `varchar` | `"Index Fund"` |
| `indexfundreturndailystdevafterexpense` | `varchar` | `"0.00100000"` |
| `indexfundreturndailystdevbeforeexpense` | `varchar` | `"0.00100000"` |
| `indexfundreturndiffafterexpense` | `varchar` | `"0.02750000"` |
| `indexfundreturndiffbeforeexpense` | `varchar` | `"0.02000000"` |
| `interfundborrowingdaysoutstanding` | `varchar` | `"1\|2\|2\|1\|1\|1\|1\|1\|7\|5\|5\|2\|2\|1\|3"` |
| `interfundborrowingdetailsisinterfundborrowing` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `interfundborrowingloanaverage` | `varchar` | `"29579000.00000000\|4577500.00000000\|4692000.00000000\|20423000.00000000\|204123000.00000000\|21649000.00000000\|11032000.00000000\|8827000.00000000\|27882714.00000000\|18241600.00000000\|15214800.00000000\|...` |
| `interfundlendingdaysoutstanding` | `varchar` | `"44"` |
| `interfundlendingdetailsisinterfundlending` | `varchar` | `"Y"` |
| `interfundlendingloanaverage` | `varchar` | `"825.705000000000"` |
| `investadviserterminatedcrdno` | `varchar` | `null` |
| `investadviserterminatedfileno` | `varchar` | `null` |
| `investadviserterminatedlei` | `varchar` | `null` |
| `investadviserterminationdate` | `varchar` | `null` |
| `investmentadvisercountry` | `varchar` | `null` |
| `investmentadvisercrdno` | `varchar` | `"000149120\|000149120\|000149120\|000149120"` |
| `investmentadviserfileno` | `varchar` | `"801-69868\|801-69868\|801-69868\|801-69868"` |
| `investmentadviserhiredisinvestmentadviserhired` | `varchar` | `"Y"` |
| `investmentadviserlei` | `varchar` | `"N/A\|N/A\|N/A\|N/A"` |
| `investmentadvisername` | `varchar` | `"ArrowMark Colorado Holdings, LLC\|ArrowMark Colorado Holdings, LLC\|ArrowMark Colorado Holdings, LLC\|ArrowMark Colorado Holdings, LLC"` |
| `investmentadviserrssdid` | `varchar` | `null` |
| `investmentadviserstartdate` | `varchar` | `"2017-08-16"` |
| `investmentadviserstate` | `varchar` | `"US-CO\|US-CO\|US-CO\|US-CO"` |
| `investmentadviserstatecountryinvestmentadvisercountry` | `varchar` | `"US\|US\|US\|US"` |
| `investmentadviserterminatedcountry` | `varchar` | `null` |
| `investmentadviserterminatedname` | `varchar` | `null` |
| `investmentadviserterminatedstate` | `varchar` | `null` |
| `investmentcompfileno` | `varchar` | `"811-04014"` |
| `investmentcompanytype` | `varchar` | `"N-1A"` |
| `investmenttype` | `varchar` | `null` |
| `isaccountingprinciplechange` | `varchar` | `"N"` |
| `isadminaffiliated` | `varchar` | `"N\|N\|N\|N"` |
| `isadminhiredorterminated` | `varchar` | `"N\|N\|N\|N"` |
| `isadminsubadmin` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `isaffiliatedperson` | `varchar` | `null` |
| `isbrokerageresearchpayment` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `isbyaffiliatedperson` | `varchar` | `null` |
| `isccochangedsincelastfiling` | `varchar` | `"N"` |
| `ischangeaccprinciples` | `varchar` | `"false"` |
| `isclaimfiled` | `varchar` | `"N"` |
| `isclaimfiledduringperiod` | `varchar` | `"N"` |
| `iscodeofethics` | `varchar` | `null` |
| `iscollateralmanageraffliliated` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `iscollateralmanageraffliliatedwithfund` | `varchar` | `"N\|N\|N\|N"` |
| `iscollateralrequired` | `varchar` | `"Y\|N\|N"` |
| `iscoveredbyinsurancepolicy` | `varchar` | `"N"` |
| `iscreditlinecommitted` | `varchar` | `"Uncommitted\|Uncommitted\|Uncommitted\|Uncommitted\|Uncommitted\|Uncommitted\|Uncommitted\|Uncommitted\|Uncommitted"` |
| `iscreditlineused` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `iscustodianaffiliated` | `varchar` | `"N\|N\|N\|N"` |
| `iscustodianhiredorterminated` | `varchar` | `"N\|N\|N\|N"` |
| `isdefaultlongtermdebt` | `varchar` | `null` |
| `isdirectorinterestedperson` | `varchar` | `"Y\|N\|N\|N\|N\|N"` |
| `isdividendsinarrears` | `varchar` | `null` |
| `isexclusivefund` | `varchar` | `null` |
| `isexemptionfromact` | `varchar` | `"N"` |
| `isexpenselimitationinplace` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `isexpensereducedorwaived` | `varchar` | `"Y\|N\|N\|N"` |
| `isexpensewaivedrecoupable` | `varchar` | `"Y\|Y\|Y\|N"` |
| `isfeeswaivedrecoupable` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `isfinancialsupportduringperiod` | `varchar` | `"N"` |
| `isfirstfilingbyfund` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `isforeignsubsidiary` | `varchar` | `"N\|N\|N\|N"` |
| `isfundadverselyimpacted` | `varchar` | `"N\|N\|N\|N"` |
| `isfundliquidated` | `varchar` | `"N\|N\|N\|N"` |
| `isfundsecuritieslending` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `isipareportinternalcontrol` | `varchar` | `"true"` |
| `isinkindetf` | `varchar` | `"Y\|N\|N"` |
| `isindexfundaffiliated` | `varchar` | `"N"` |
| `isindexfundexclusive` | `varchar` | `"N"` |
| `isinfoitem405` | `varchar` | `null` |
| `isinforequiredeo` | `varchar` | `"false"` |
| `isinstdefiningrights` | `varchar` | `null` |
| `isinterfundborrowing` | `varchar` | `"N\|N\|N\|N"` |
| `isinterfundlending` | `varchar` | `"N\|N\|N\|N"` |
| `isinvestmentadviserhired` | `varchar` | `"N\|N\|N\|N"` |
| `islegalproceedings` | `varchar` | `"false"` |
| `isliquidityhiredterminated` | `varchar` | `null` |
| `ismaterialamendments` | `varchar` | `null` |
| `ismaterialchange` | `varchar` | `"N"` |
| `ismaterialweakness` | `varchar` | `"N"` |
| `isneworamendedinvadvcontracts` | `varchar` | `null` |
| `isnondiversifiedcompany` | `varchar` | `"N\|N\|N\|N"` |
| `isopinionoffered` | `varchar` | `"N"` |
| `isotherinforequired` | `varchar` | `"false"` |
| `ispaymentdividend` | `varchar` | `"N"` |
| `ispaymenterrorinnetassetvalue` | `varchar` | `"N"` |
| `ispreviouslegalproceeding` | `varchar` | `"N"` |
| `ispreviousproceedingterminated` | `varchar` | `"N"` |
| `ispricingserviceaffiliated` | `varchar` | `"N\|N\|N\|N"` |
| `ispricingservicehiredorterminated` | `varchar` | `"N\|N\|N\|N"` |
| `isprincipalunderwriteraffiliatedwithregistrant` | `varchar` | `"N"` |
| `isprovisionfinancialsupport` | `varchar` | `"false"` |
| `ispublicaccountantchanged` | `varchar` | `"Y"` |
| `isregistrantfamilyinvcomp` | `varchar` | `"N"` |
| `isregistrantfirstfiling` | `varchar` | `"Y"` |
| `isregistrantlastfiling` | `varchar` | `"N"` |
| `isregistrantseparateinsuranceaccount` | `varchar` | `null` |
| `isregistrantsubmittedmatter` | `varchar` | `"N"` |
| `isreportperiodlt12` | `varchar` | `"N"` |
| `isrepurchasesecurity` | `varchar` | `null` |
| `isrightsoffering` | `varchar` | `null` |
| `isrule11a2reliance` | `varchar` | `null` |
| `isrule12d1dash4reliance` | `varchar` | `null` |
| `isrule12d1greliance` | `varchar` | `null` |
| `isrule6c7reliance` | `varchar` | `null` |
| `issecondaryoffering` | `varchar` | `null` |
| `issecuritiesactregistration` | `varchar` | `"Y"` |
| `issecuritiesagentaffiliated` | `varchar` | `"N\|N\|N\|N"` |
| `issecuritiesmodified` | `varchar` | `null` |
| `issecurityagentidemnity` | `varchar` | `null` |
| `isshareholderserviceagentaffiliated` | `varchar` | `"N\|N\|N\|N"` |
| `isshareholderserviceagentsubshare` | `varchar` | `"N\|N\|N\|N"` |
| `isshareholderservicehiredterminated` | `varchar` | `"N\|N\|N\|N"` |
| `issubadviseraffiliated` | `varchar` | `"Y\|Y"` |
| `issubadviserhired` | `varchar` | `"N\|N"` |
| `issubcustodian` | `varchar` | `"N\|N\|N\|N"` |
| `isswingpricing` | `varchar` | `"N\|N\|N\|N"` |
| `istransferagentaffiliated` | `varchar` | `"N\|N\|N\|N"` |
| `istransferagenthiredorterminated` | `varchar` | `"N\|N\|N\|N"` |
| `istransferagentsubagent` | `varchar` | `"N\|N\|N\|N"` |
| `isuitadminaffiliated` | `varchar` | `null` |
| `isuitadminhiredterminated` | `varchar` | `null` |
| `isuitadminsubadmin` | `varchar` | `null` |
| `isunderwriterhiredorterminated` | `varchar` | `"N"` |
| `legalproceedingseriesinfoispreviouslegalproceeding` | `varchar` | `null` |
| `lineofcredithaslineofcredit` | `varchar` | `"Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y"` |
| `lineofcreditsize` | `varchar` | `"15000000.000000000000\|15000000.000000000000\|15000000.000000000000\|15000000.000000000000\|15000000.000000000000\|15000000.000000000000\|15000000.000000000000\|15000000.000000000000\|15000000.000000000000"` |
| `liquiditycountry` | `varchar` | `null` |
| `liquiditylei` | `varchar` | `null` |
| `liquidityname` | `varchar` | `null` |
| `liquidityrssdid` | `varchar` | `null` |
| `liquiditystate` | `varchar` | `null` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `managementfee` | `varchar` | `null` |
| `marketpricepershare` | `varchar` | `null` |
| `masterfeederfundinfofundtype` | `varchar` | `null` |
| `masterfundfileno` | `varchar` | `null` |
| `masterfundlei` | `varchar` | `null` |
| `masterfundname` | `varchar` | `null` |
| `masterfundsecfileno` | `varchar` | `null` |
| `mgmtinvfundname` | `varchar` | `"Meridian Small Cap Growth Fund\|Meridian Contrarian Fund\|Meridian Equity Income Fund\|Meridian Growth Fund"` |
| `mgmtinvlei` | `varchar` | `"549300QR2Q648V4ME788\|549300ZPXT46KP22W756\|549300Y3M201YW1GRZ09\|549300TNUS7M3I8SH017"` |
| `mgmtinvseriesid` | `varchar` | `"S000042770\|S000001463\|S000001461\|S000001462"` |
| `mnthlyavgnetassets` | `varchar` | `"1307344669.810000000000\|645325587.390000000000\|54741714.360000000000\|1639791379.260000000000"` |
| `netassetvaluepershare` | `varchar` | `null` |
| `netincomesecuritieslending` | `varchar` | `"1769054.780000000000\|1022086.840000000000\|110754.970000000000\|1301294.210000000000"` |
| `netoperatingexpenses` | `varchar` | `null` |
| `newseriesaggregatevalue` | `varchar` | `null` |
| `numaddedclass` | `varchar` | `"0\|0\|0\|0"` |
| `numauthorizedclass` | `varchar` | `"5\|5\|5\|5"` |
| `numcontractsaffected` | `varchar` | `null` |
| `numcontractsaffectedredeemed` | `varchar` | `null` |
| `numcontractssold` | `varchar` | `null` |
| `numofcontracts` | `varchar` | `null` |
| `numofexistingseries` | `varchar` | `null` |
| `numofexistingseriesadditionalunits` | `varchar` | `null` |
| `numofnewseriesregistration` | `varchar` | `null` |
| `numofseriescurrentprospectus` | `varchar` | `null` |
| `numterminatedclass` | `varchar` | `"0\|0\|0\|0"` |
| `officeaddress1` | `varchar` | `"225 Liberty Street"` |
| `officeaddress2` | `varchar` | `"One Lincoln Street\|Suite 4345"` |
| `officecity` | `varchar` | `"New York"` |
| `officecountry` | `varchar` | `null` |
| `officename` | `varchar` | `"The Bank of New York Mellon"` |
| `officephone` | `varchar` | `"212-495-1784"` |
| `officerecordszipcode` | `varchar` | `"10286"` |
| `officestate` | `varchar` | `"US-NY"` |
| `officestatecountryofficecountry` | `varchar` | `"US"` |
| `othercustodiandesc` | `varchar` | `null` |
| `otherfeedesc` | `varchar` | `null` |
| `otherrepurchasesecuritydesc` | `varchar` | `null` |
| `othersecuritydescription` | `varchar` | `null` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `paymentdividendseriesispaymentdividend` | `varchar` | `"Y"` |
| `paymenterrorseriesispaymenterrorinnetassetvalue` | `varchar` | `"Y"` |
| `paymenterrorseriesseriesinfoseriesid` | `varchar` | `"S000039806"` |
| `paymenterrorseriesseriesinfoseriesname` | `varchar` | `"AdvisorShares Sage Core Reserves ETF"` |
| `paymenttoagentmanagertype` | `varchar` | `"N/A\|N/A"` |
| `paymenttoagentmanagerspaymenttoagentmanagertype` | `varchar` | `"Revenue sharing split\|Revenue sharing split\|Revenue sharing split\|Revenue sharing split"` |
| `pcaobnumber` | `varchar` | `"238\|925"` |
| `percentsdredeemed` | `varchar` | `"0.0017\|0\|0"` |
| `previousproceedingterminatedispreviousproceedingterminated` | `varchar` | `null` |
| `pricingservicecountry` | `varchar` | `"BM\|BM"` |
| `pricingserviceidnumberdesc` | `varchar` | `"SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC File Number\|SEC ...` |
| `pricingservicelei` | `varchar` | `"N/A\|N/A\|N/A\|N/A"` |
| `pricingservicename` | `varchar` | `"ICE Data Services\|ICE Data Services\|ICE Data Services\|ICE Data Services"` |
| `pricingserviceother` | `varchar` | `null` |
| `pricingservicerssdid` | `varchar` | `null` |
| `pricingservicestate` | `varchar` | `"US-MA\|US-MA\|US-MA\|US-MA"` |
| `pricingservicestatecountrypricingservicecountry` | `varchar` | `"US\|US\|US\|US"` |
| `principalaggregatepurchase` | `varchar` | `"139983082.000000000000\|3149927.000000000000\|1692250.000000000000\|58220138.000000000000"` |
| `principalcountry` | `varchar` | `"FR\|GB\|NL\|FR\|FR\|CH\|FR\|GB\|CH\|JP\|DE\|GB\|CA\|JP"` |
| `principalcrdno` | `varchar` | `"000007616\|000000816\|000000079\|000001252\|000126292\|000008158\|000000665\|000007560\|000002347\|000000361\|000007560\|000126292\|000007560\|000008209\|000000361\|000126292\|000140139\|000000816\|000000079\|000007...` |
| `principalfileno` | `varchar` | `"008-22522\|008-00422\|008-35008\|008-02698\|008-65876\|008-00497\|008-15204\|008-17574\|008-15074\|008-00129\|008-17574\|008-65876\|008-17574\|008-15869\|008-00129\|008-65876\|008-67284\|008-00422\|008-35008\|008-22...` |
| `principallei` | `varchar` | `"549300WR155U7DVMIW58\|1V8Y6QCX6YMJ2OELII46\|ZBUT11V806EZRVTWT807\|549300J0P7XYE8BMZ775\|VYVVCKR63DVZZN70PB21\|549300772UJAHRD6LO53\|549300GRQCWQ3XGH0H10\|ZI8Q1A8EI8LQFJNM0D94\|58PU97L1C0WSRCWADL48\|FOR8UP2...` |
| `principalname` | `varchar` | `"Cowen & Company\|CREDIT SUISSE SECURITIES (USA) LLC\|J.P. Morgan Securities LLC\|WILLIAM BLAIR & CO. LLC\|WELLS FARGO SECURITIES LLC\|ROBERT W BAIRD & CO. INC.\|PIPER JAFFRAY & CO.\|PERSHING LLC\|JEFFERIE...` |
| `principalrssdid` | `varchar` | `null` |
| `principalstate` | `varchar` | `"US-NY\|US-NY\|US-NY\|US-IL\|US-NC\|US-WI\|US-MN\|US-NJ\|US-NY\|US-NY\|US-NJ\|US-NC\|US-NJ\|US-NY\|US-NY\|US-NC\|US-ND\|US-NY\|US-NY\|US-NY\|US-NY"` |
| `principalstatecountryprincipalcountry` | `varchar` | `"US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US\|US"` |
| `principaltotalpurchasesale` | `varchar` | `"5096454.000000000000\|15049166.000000000000\|7055784.000000000000\|4346270.000000000000\|14520242.000000000000\|6064092.000000000000\|5741164.000000000000\|54879869.000000000000\|6842738.000000000000\|1666...` |
| `principalunderwritercountry` | `varchar` | `"US"` |
| `principalunderwriterstate` | `varchar` | `"US-CO"` |
| `principalunderwritercrdnumber` | `varchar` | `"000016853"` |
| `principalunderwriterfilenumber` | `varchar` | `"008-34626"` |
| `principalunderwriterlei` | `varchar` | `"N/A"` |
| `principalunderwritername` | `varchar` | `"ALPS Distributors, Inc."` |
| `principalunderwriterrssdid` | `varchar` | `null` |
| `publicaccountantcountry` | `varchar` | `"US\|US"` |
| `publicaccountantlei` | `varchar` | `"5493002GVO7EO8RNNS37\|N/A"` |
| `publicaccountantname` | `varchar` | `"PricewaterhouseCoopers LLP\|Cohen & Company, Ltd."` |
| `publicaccountantrssdid` | `varchar` | `null` |
| `publicaccountantstate` | `varchar` | `"US-NY\|US-OH"` |
| `purchasecreationunitcashpermoreunits` | `varchar` | `"750\|500\|500"` |
| `purchasecreationunitcashperunit` | `varchar` | `"0\|0\|0"` |
| `purchasecreationunitcashpercentageperunit` | `varchar` | `"0\|0\|0"` |
| `purchasecreationunitdollarpermoreunits` | `varchar` | `"750\|500\|500"` |
| `purchasecreationunitdollarperunit` | `varchar` | `"0\|0\|0"` |
| `purchasecreationunitdollarpercentageperunit` | `varchar` | `"0\|0\|0"` |
| `regfeederfundfileno` | `varchar` | `null` |
| `regfeederfundlei` | `varchar` | `null` |
| `regfeederfundseriesidno` | `varchar` | `null` |
| `registrantcik` | `varchar` | `"0000745467"` |
| `registrantclassificationtype` | `varchar` | `"N-1A"` |
| `registrantfamilyinvcompisregistrantfamilyinvcomp` | `varchar` | `"Y"` |
| `registrantfullname` | `varchar` | `"MERIDIAN FUND INC"` |
| `registrantlei` | `varchar` | `"54930021O592GQO2XJ18"` |
| `registrantseparateinsuranceaccountisregistrantseparateinsuranceaccount` | `varchar` | `null` |
| `registrantsignedname` | `varchar` | `"MERIDIAN FUND INC"` |
| `registrantcity` | `varchar` | `"Denver"` |
| `registrantcountry` | `varchar` | `"US"` |
| `registrantphonenumber` | `varchar` | `"303-398-2929"` |
| `registrantstate` | `varchar` | `"US-CO"` |
| `registrantstreet1` | `varchar` | `"100 Fillmore Street"` |
| `registrantstreet2` | `varchar` | `"Suite 325"` |
| `registrantzipcode` | `varchar` | `"80206"` |
| `releasenumber` | `varchar` | `"IC-19647"` |
| `releasenumbersisexemptionfromact` | `varchar` | `"Y"` |
| `relyonruletype` | `varchar` | `"N/A\|N/A\|N/A\|N/A"` |
| `relyonruletypesrelyonruletype` | `varchar` | `"Rule 32a-4 (17 CFR 270.32a-4)\|Rule 17a-7 (17 CFR 270.17a-7)\|Rule 17e-1 (17 CFR 270.17e-1)\|Rule 12d1-1 (17 CFR 270.12d1-1)\|Rule 17e-1 (17 CFR 270.17e-1)\|Rule 32a-4 (17 CFR 270.32a-4)\|Rule 17a-7 (17...` |
| `reportendingperiod` | `varchar` | `"2018-06-30"` |
| `repurchasesecuritiesisrepurchasesecurity` | `varchar` | `null` |
| `repurchasesecuritytype` | `varchar` | `null` |
| `returncopyflag` | `varchar` | `"false"` |
| `rightsofferingfundsisrightsoffering` | `varchar` | `null` |
| `rightsofferingparticipationpercent` | `varchar` | `null` |
| `rightsofferingtype` | `varchar` | `null` |
| `rptincludeallclassesflag` | `varchar` | `null` |
| `rptincludeallseriesflag` | `varchar` | `"true"` |
| `rptseriesclassinfoseriesid` | `varchar` | `"S000056280\|S000056279\|S000059908"` |
| `schemaversion` | `varchar` | `null` |
| `secfileno` | `varchar` | `"811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08200\|811-08...` |
| `secondaryofferingtype` | `varchar` | `null` |
| `secondaryofferingsissecondaryoffering` | `varchar` | `null` |
| `securitiesagentlei` | `varchar` | `"HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49\|HPFHU0OQ28E4N0NFVK49"` |
| `securitiesagentname` | `varchar` | `"BNY Mellon\|BNY Mellon\|BNY Mellon\|BNY Mellon"` |
| `securityagentidemnityissecurityagentidemnity` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `securityclasstitle` | `varchar` | `null` |
| `securitymatterseriesinfoisregistrantsubmittedmatter` | `varchar` | `"Y"` |
| `securitymatterseriesinfoseriesinfoseriesid` | `varchar` | `"N/A"` |
| `securitymatterseriesinfoseriesinfoseriesname` | `varchar` | `"N/A"` |
| `separateaccountcontractid` | `varchar` | `null` |
| `separateaccountsecurityname` | `varchar` | `null` |
| `separateaccountseriesid` | `varchar` | `null` |
| `separateaccounttotalasset` | `varchar` | `null` |
| `seriescikcik` | `varchar` | `null` |
| `seriesid` | `varchar` | `null` |
| `seriesinfoseriesid` | `varchar` | `"S000028994"` |
| `seriesinfoseriesname` | `varchar` | `"Small-Cap Momentum Fund"` |
| `seriesname` | `varchar` | `null` |
| `shareholderserviceagentcountry` | `varchar` | `null` |
| `shareholderserviceagentlei` | `varchar` | `"549300CFZQLI9QMJ1Z03\|549300CFZQLI9QMJ1Z03\|549300CFZQLI9QMJ1Z03\|549300CFZQLI9QMJ1Z03"` |
| `shareholderserviceagentname` | `varchar` | `"BNY Mellon Investment Servicing (US), Inc.\|BNY Mellon Investment Servicing (US), Inc.\|BNY Mellon Investment Servicing (US) Inc.\|BNY Mellon Investment Servicing (US), Inc."` |
| `shareholderserviceagentother` | `varchar` | `null` |
| `shareholderserviceagentrssdid` | `varchar` | `null` |
| `shareholderserviceagentstate` | `varchar` | `"US-PA\|US-PA\|US-PA\|US-PA"` |
| `shareholderserviceagentstatecountryshareholderserviceagentcountry` | `varchar` | `"US\|US\|US\|US"` |
| `shareholderserviceidnumberdesc` | `varchar` | `"801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716\|801-066716"` |
| `sharesoutstandingclassid` | `varchar` | `"C000132293\|C000132296\|C000132294\|C000132295\|C000156530\|C000132943\|C000132942\|C000156529\|C000003883\|C000003881\|C000132937\|C000156527\|C000132936\|C000132941\|C000003882\|C000132940\|C000132939\|C000156528"` |
| `sharesoutstandingclassname` | `varchar` | `"Legacy Class\|Institutional Class\|Investor Class\|Class A\|Class C\|Class A\|Investor Class\|Class C\|Legacy Class\|Legacy Class\|Class A\|Class C\|Investor Class\|Institutional Class\|Legacy Class\|Class A\|Inv...` |
| `sharesoutstandingtickersymbol` | `varchar` | `"MSGGX\|MSGRX\|MISGX\|MSGAX\|MSGCX\|MFCAX\|MFCIX\|MFCCX\|MVALX\|MEIFX\|MRAEX\|MRCEX\|MRIEX\|MRRGX\|MERDX\|MRAGX\|MRIGX\|MRCGX"` |
| `signature` | `varchar` | `"/s/ David J. Corkins"` |
| `signeddate` | `varchar` | `"2018-09-07"` |
| `solecredittypecredittype` | `varchar` | `null` |
| `sponsorcountry` | `varchar` | `null` |
| `sponsorcrdno` | `varchar` | `null` |
| `sponsorlei` | `varchar` | `null` |
| `sponsorname` | `varchar` | `null` |
| `sponsorrssdid` | `varchar` | `null` |
| `sponsorstate` | `varchar` | `null` |
| `standarddeviationpurchased` | `varchar` | `"0\|0\|0"` |
| `statutoryregulatorybasis` | `varchar` | `null` |
| `subadvisercountry` | `varchar` | `"KR"` |
| `subadvisercrdno` | `varchar` | `"000108252\|000108252"` |
| `subadviserfileno` | `varchar` | `"801-34590\|801-34590"` |
| `subadviserhiredissubadviserhired` | `varchar` | `null` |
| `subadviserlei` | `varchar` | `"54930027O2AJWDBVT542\|54930027O2AJWDBVT542"` |
| `subadvisername` | `varchar` | `"FIDELITY INVESTMENTS MONEY MANAGEMENT, INC.\|FIDELITY INVESTMENTS MONEY MANAGEMENT, INC."` |
| `subadviserrssdid` | `varchar` | `null` |
| `subadviserstartdate` | `varchar` | `null` |
| `subadviserstate` | `varchar` | `"US-MA\|US-MA"` |
| `subadviserstatecountrysubadvisercountry` | `varchar` | `"US\|US"` |
| `subadviserterminatedcountry` | `varchar` | `null` |
| `subadviserterminatedcrdno` | `varchar` | `"000134484"` |
| `subadviserterminatedfileno` | `varchar` | `"801-65488"` |
| `subadviserterminatedlei` | `varchar` | `"U1DBGW378QDQGQKA1X16"` |
| `subadviserterminatedname` | `varchar` | `"Passport Capital, LLC"` |
| `subadviserterminatedstate` | `varchar` | `"US-CA"` |
| `subadviserterminatedstatecountrysubadviserterminatedcountry` | `varchar` | `"US"` |
| `subadviserterminationdate` | `varchar` | `"2018-01-19"` |
| `submissiontype` | `varchar` | `"N-CEN"` |
| `terminatedseriesinfoseriesid` | `varchar` | `"S000031642\|S000028889"` |
| `terminatedseriesinfoseriesname` | `varchar` | `"AdvisorShares Meidell Tactical Advantage ETF\|AdvisorShares Peritus High Yield ETF"` |
| `terminationdate` | `varchar` | `"04/2018\|06/2018"` |
| `title` | `varchar` | `"Principal Executive Officer and President"` |
| `totalassetsseries` | `varchar` | `null` |
| `totalseries` | `varchar` | `"4"` |
| `transferagentcountry` | `varchar` | `null` |
| `transferagentfileno` | `varchar` | `"084-01761\|084-01761\|084-01761\|084-01761"` |
| `transferagentlei` | `varchar` | `"549300CFZQLI9QMJ1Z03\|549300CFZQLI9QMJ1Z03\|549300CFZQLI9QMJ1Z03\|549300CFZQLI9QMJ1Z03"` |
| `transferagentname` | `varchar` | `"BNY Mellon Investment Servicing (U.S.) Inc.\|BNY Mellon Investment Servicing (U.S.) Inc.\|BNY Mellon Investment Servicing (U.S.) Inc.\|BNY Mellon Investment Servicing (U.S.) Inc."` |
| `transferagentrssdid` | `varchar` | `null` |
| `transferagentstate` | `varchar` | `"US-DE\|US-DE\|US-DE\|US-DE"` |
| `transferagentstatecountrytransferagentcountry` | `varchar` | `"US\|US\|US\|US"` |
| `trusteecountry` | `varchar` | `null` |
| `trusteename` | `varchar` | `null` |
| `trusteestate` | `varchar` | `null` |
| `uitadmincountry` | `varchar` | `null` |
| `uitadmindescothernumber` | `varchar` | `null` |
| `uitadminlei` | `varchar` | `null` |
| `uitadminname` | `varchar` | `null` |
| `uitadminother` | `varchar` | `null` |
| `uitadminrssdid` | `varchar` | `null` |
| `uitadminstate` | `varchar` | `null` |
| `unitinportfoliovalue` | `varchar` | `null` |
| `unregfeederfileno` | `varchar` | `null` |
| `unregfeederfundlei` | `varchar` | `null` |
| `valuationmethodschangeseriesseriesinfoseriesid` | `varchar` | `null` |
| `valuationmethodschangeseriesseriesinfoseriesname` | `varchar` | `null` |
| `valuationmethodschangesismaterialchange` | `varchar` | `null` |
| `webpage` | `varchar` | `"www.meridianfund.com"` |

### n_mfp

document_types: `N-MFP`, `N-MFP/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `150066610000111` |
| `filingdate` | `varchar` | `"2010-12-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2010-12-01/n_mfp/000150066610000111.parquet"` |
| `_table` | `varchar` | `"n_mfp"` |
| `administrator` | `varchar` | `"Sentinel Administrative Services, Inc."` |
| `adviserfilenumber` | `varchar` | `"801-57721"` |
| `advisername` | `varchar` | `"Sentinel Asset Management, Inc."` |
| `assetsnet` | `varchar` | `"1511114.89"` |
| `assetssoldunderagreementstorepurchasecarryingamounts` | `varchar` | `"14079018.00\|2352613.00\|3349444.00\|15239529.00\|15006900.00\|15000000.00\|15000000.00\|15000000.00\|15000000.00\|15000000.00\|3688647.00\|1155000.00\|4916718.00\|3502521.00\|4449224.00\|1249720.00\|2688488.00\|2...` |
| `availableforsalesecuritiesamortizedcost` | `varchar` | `"14927568.55"` |
| `cr` | `varchar` | `"3.500\|4.500\|4.000\|4.500\|5.000\|5.000\|5.000\|5.500\|6.000\|6.000\|5.000\|5.500\|7.000\|7.000\|7.000\|4.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.000\|7.00...` |
| `cusipmember` | `varchar` | `"313397T27\|313588DT9\|313589T52\|313589T86\|313589U92\|313384AG4\|313384BL2\|313384CH0\|313385R73\|313385U79\|313396BG7\|313397S36\|00282DN48\|19121BNB1\|47816GN54\|64105HNK4\|71344UNQ8\|74271UQ78\|9113A3N42\|912795...` |
| `cashcollateralforborrowedsecurities` | `varchar` | `"14554712.03\|2394972.15\|3450316.59\|16119360.89\|15698172.76\|3717014.42\|14993635.12\|3861710.43\|803003.59\|784704.78\|3971905.15\|1251368.87\|1205572.86\|1167388.90\|1205294.92\|1172491.73\|1229360.85\|1164613...` |
| `categoryofinvestmentdesc` | `varchar` | `"EURO TIME DEPOSIT-CAYMAN"` |
| `city` | `varchar` | `"New York"` |
| `classid` | `varchar` | `"C000026187"` |
| `containedfileinformationfilenumber` | `varchar` | `"333-35832"` |
| `date` | `varchar` | `"2025-11-15\|2040-02-15\|2040-11-15\|2040-10-20\|2052-08-15\|2018-10-15\|2039-09-15\|2033-03-15\|2028-12-15\|2028-11-15\|2040-11-20\|2051-07-15\|2038-12-15\|2038-10-15\|2038-10-15\|2039-05-15\|2038-11-15\|2038-10-1...` |
| `dateasofwhichvaluewascalculated` | `varchar` | `"2010-11-30"` |
| `datecalculatedfornetvaluepershareexcludingcapitalsupportagreement` | `varchar` | `"2010-11-30"` |
| `datecalculatedfornetvaluepershareincludingcapitalsupportagreement` | `varchar` | `"2010-11-30"` |
| `demandfeatureissuerinvestmentissuer` | `varchar` | `"BASF SE\|FEDERAL HOME LOAN MORTGAGE CORPORATION\|AGFIRST FARM CREDIT BANK\|UNION BANK\|DEXIA CREDIT LOCAL DE FRANCE\|FEDERAL HOME LOAN MORTGAGE CORPORATION\|FEDERAL HOME LOAN BANK\|CHRISTIANA CARE HLTH S...` |
| `documentperiodenddate` | `varchar` | `"2010-11-30"` |
| `doessecurityhavedemandfeature` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `doessecurityhaveenhancementsonwhichfundrelying` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `doessecurityhaveguarantee` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `dollarweightedaveragelifematurity` | `varchar` | `"39"` |
| `dollarweightedaverageportfoliomaturity` | `varchar` | `"39"` |
| `enhancementprovider` | `varchar` | `"AMSTERDAM FUNDING CORP\|ROYAL BANK OF SCOTLAND PLC\|AMSTERDAM FUNDING CORP\|ROYAL BANK OF SCOTLAND PLC\|RABOBANK NEDERLAND\|RABOBANK NEDERLAND\|CAFCO\|CITIBANK NA, NEW YORK\|CANCARA ASSET SECURITISATION L...` |
| `entitycentralindexkey` | `varchar` | `"0001112513"` |
| `entityregistrantname` | `varchar` | `null` |
| `feederfundcontainedfileinformationfilenumber` | `varchar` | `null` |
| `feederfundentitycentralindexkey` | `varchar` | `null` |
| `feederfundentityregistrantname` | `varchar` | `null` |
| `feederfundseriesidentifier` | `varchar` | `null` |
| `filenumber` | `varchar` | `"084-06175"` |
| `finallegalinvestmentmaturitydate` | `varchar` | `"2010-12-14\|2011-03-31\|2010-12-17\|2010-12-20\|2010-12-29\|2011-01-07\|2011-02-04\|2011-02-25\|2010-12-03\|2010-12-27\|2011-01-31\|2010-12-07\|2011-01-04\|2011-01-11\|2011-01-05\|2011-01-19\|2011-01-24\|2011-03-0...` |
| `from` | `varchar` | `null` |
| `grossredemptionsformonthended` | `varchar` | `"684372.46"` |
| `grosssubscriptionsformonthended` | `varchar` | `"499363.66"` |
| `hasfundacquiredormergedwithanotherfundsincelastfiling` | `varchar` | `"N"` |
| `investmentidentifier` | `varchar` | `"067800\|319337\|251524\|381906\|617436\|590188"` |
| `investmentissuer` | `varchar` | `"FHLMC DISCOUNT NOTE\|FEDERAL NAT'L MTG ASSOC.\|FEDERAL NAT'L MTG ASSOC.\|FEDERAL NAT'L MTG ASSOC.\|FEDERAL NAT'L MTG ASSOC.\|FHLB DISC CORP.\|FHLB DISC CORP.\|FHLB DISC CORP.\|FHLB DISC CORP.\|FHLB DISC CO...` |
| `investmentmaturitydate` | `varchar` | `"2010-12-14\|2011-03-31\|2010-12-17\|2010-12-20\|2010-12-29\|2011-01-07\|2011-02-04\|2011-02-25\|2010-12-03\|2010-12-27\|2011-01-31\|2010-12-07\|2011-01-04\|2011-01-11\|2011-01-05\|2011-01-19\|2011-01-24\|2011-03-0...` |
| `investmentownedatfairvalue` | `varchar` | `"649976.52\|149915.00\|499968.88\|499963.05\|499945.55\|899879.75\|549851.04\|499820.83\|449998.50\|599939.33\|699822.08\|259995.66\|999858.33\|359938.50\|299956.25\|509895.87\|749831.25\|289853.06\|749893.75\|649998...` |
| `investmentownedbalanceprincipalamount` | `varchar` | `"650000.00\|150000.00\|500000.00\|500000.00\|500000.00\|900000.00\|550000.00\|500000.00\|450000.00\|600000.00\|700000.00\|260000.00\|1000000.00\|360000.00\|300000.00\|510000.00\|750000.00\|290000.00\|750000.00\|65000...` |
| `investmentownedinvestmentadditionalinformation` | `varchar` | `"N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A\|N/A N/A N/A"` |
| `investmentownedpercentofnetassets` | `varchar` | `"0.0430\|0.0099\|0.0331\|0.0331\|0.0331\|0.0595\|0.0364\|0.0331\|0.0298\|0.0397\|0.0463\|0.0172\|0.0662\|0.0238\|0.0198\|0.0337\|0.0496\|0.0192\|0.0496\|0.0430\|0.0397\|0.0132\|0.0265\|0.0331\|0.0298\|0.0380\|0.0198\|0.0430\|...` |
| `investmenttitle` | `varchar` | `"FHLMC DISCOUNT NOTE0.00155\|FEDERAL NAT'L MTG ASSOC.0.0016\|FEDERAL NAT'L MTG ASSOC.0.00185\|FEDERAL NAT'L MTG ASSOC.0.0017\|FEDERAL NAT'L MTG ASSOC.0.00175\|FHLB DISC CORP.0.0015\|FHLB DISC CORP.0.0016...` |
| `investmenttypedomain` | `varchar` | `"Prime"` |
| `isfundliquidating` | `varchar` | `"N"` |
| `isfundmergingwithorbeingacquiredbyanotherfund` | `varchar` | `"N"` |
| `isfundtreatingasacquisitionunderlyingsecurities` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `isthiselectroniccopyofpaperformat` | `varchar` | `"N"` |
| `isthisfeederfund` | `varchar` | `"N"` |
| `isthisfinalfiling` | `varchar` | `"N"` |
| `isthisilliquidsecurity` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `isthismasterfund` | `varchar` | `"N"` |
| `isthisseriesprimarilyusedtofundinsurancecompanyseperateaccounts` | `varchar` | `"N"` |
| `liabilities` | `varchar` | `"26186.92"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `masterfundentitycentralindexkey` | `varchar` | `null` |
| `mininitialinvestment` | `varchar` | `"1.00"` |
| `moneymarketsevendayyield` | `varchar` | `".0000"` |
| `nrsroratinglistnrsroratingr` | `varchar` | `"NR\|P-1\|A-1\|F1+\|P-1\|A-1\|NR\|P-1\|A-1\|F1+\|P-1\|A-1\|F1+\|P-1\|A-1+\|F1+\|P-1\|A-1+\|F1+\|P-1\|A-1\|F1+\|P-1\|A-1\|NR\|P-1\|A-1\|F1+\|P-1\|A-1\|NR\|P-1\|A-1\|F1+\|P-1\|A-1\|NR\|P-1\|A-1\|F1+\|P-1\|A-1\|F1+\|P-1\|A-1\|F1+\|P-1\|A-1\|F1+\|P-1...` |
| `nrsroratinglistnrsroratingran` | `varchar` | `"FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&...` |
| `nrsroratingr` | `varchar` | `"F1+\|P-1\|A-1+\|F1+\|NR\|A-1+\|F1\|P-1\|A-1\|F1+\|P-1\|A-1\|AAA\|P-1\|A-1+\|AA\|P-1\|NR\|F1+\|P-1\|A-1\|F1+\|NR\|A-1+\|F1+\|P-1\|A-1+\|NR\|Aa3\|AA+\|F1+\|P-1\|A-1+\|F1+\|P-1\|A-1+\|F1+\|P-1\|A-1\|AAA\|P-1\|A-1+\|F1+\|P-1\|A-1+\|F1\|P-1\|A-1\|F1...` |
| `nrsroratingran` | `varchar` | `"FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&...` |
| `nrsrosratingr` | `varchar` | `"F1\|P-1\|A-1\|F1+\|P-1\|A-1+\|F1+\|NR\|A-1+\|F1\|P-1\|A-1\|F1+\|P-1\|A-1\|AAA\|P-1\|A-1+\|NR\|P-1\|A-1+\|NR\|VMIG-1\|A-1+\|AA\|P-1\|NR\|F1+\|P-1\|A-1+\|F1+\|P-1\|A-1+\|F1+\|P-1\|NR\|F1+\|P-1\|A-1+\|F1+\|P-1\|A-1\|F1+\|P-1\|A-1\|AAA\|P-1\|A-1+\|...` |
| `nrsrosratingran` | `varchar` | `"FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&P RATING\|FITCH'S RATING\|MOODY'S RATING\|S&...` |
| `name` | `varchar` | `"PricewaterhouseCoopers LLP"` |
| `netassetvaluepershare` | `varchar` | `"1.00"` |
| `netassetvaluepershareincludingcapitalsupportagreementdateasofwhichvaluewascalculated` | `varchar` | `"2010-11-30"` |
| `netassetvaluepershareincludingcapitalsupportagreementvalue` | `varchar` | `"1.0000"` |
| `netassetsofclass` | `varchar` | `"15111144.89"` |
| `netshareholderflowactivityformonthended` | `varchar` | `"-185008.80"` |
| `netvaluepershareexcludingcapitalsupportagreement` | `varchar` | `"1.0000"` |
| `netvaluepershareincludingcapitalsupportagreement` | `varchar` | `"1.0000"` |
| `o` | `varchar` | `"FEDERAL HOME LOAN MORTGAGE CORPORATION\|AGFIRST FARM CREDIT BANK\|UNION BANK\|DEXIA CREDIT LOCAL DE FRANCE\|FEDERAL HOME LOAN MORTGAGE CORPORATION\|LANDESBANK BADEN-WURTTEMBERG\|BANK OF AMERICA, NA\|TEXA...` |
| `otherassets` | `varchar` | `"157389.42"` |
| `r` | `varchar` | `"N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A"` |
| `ran` | `varchar` | `"N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A\|N/A"` |
| `rating` | `varchar` | `"First Tier Security\|First Tier Security\|First Tier Security\|First Tier Security\|First Tier Security\|First Tier Security\|First Tier Security\|First Tier Security\|First Tier Security\|First Tier Secur...` |
| `repurchaseagreementcategoryofinvestmentdesc` | `varchar` | `null` |
| `repurchaseagreementinvestmentissuer` | `varchar` | `"GNMA\|GNMA\|GNMA\|GNM2\|GNM1\|GNM1\|GNM1\|GNM1\|GNM1\|GNM1\|GNM2\|GNM1\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|GNMA\|G...` |
| `repurchaseagreementinvestmenttypedomain` | `varchar` | `"Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government A...` |
| `scheduleofportfoliosecuritiesavailableforsalesecuritiesamortizedcost` | `varchar` | `"649963.62\|149920.00\|499958.89\|499955.14\|499931.94\|899861.25\|549836.14\|499814.86\|449997.00\|599930.67\|699833.95\|259992.85\|999839.44\|359905.70\|299953.33\|509882.00\|749820.00\|289829.87\|749915.00\|649997...` |
| `scheduleofportfoliosecuritiesentitycentralindexkey` | `varchar` | `"0000851376\|0001166296\|0000800178\|0000042352\|0001168524"` |
| `scheduleofportfoliosecuritiesinvestmenttypedomain` | `varchar` | `"Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government Agency Debt\|Government A...` |
| `seriesid` | `varchar` | `"S000009590"` |
| `seriesidentifier` | `varchar` | `null` |
| `sevendaynetyield` | `varchar` | `".0000"` |
| `state` | `varchar` | `"NY"` |
| `subadviseradviserfilenumber` | `varchar` | `null` |
| `subadviseradvisername` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"N-MFP"` |
| `to` | `varchar` | `null` |
| `totalclassesinseries` | `varchar` | `"1"` |
| `transferagententitycentralindexkey` | `varchar` | `"0001352156"` |
| `transferagentname` | `varchar` | `"Sentinel Administrative Services, Inc."` |
| `typeofenhancement` | `varchar` | `"Self Enhanced\|Letter of Credit\|Self Enhanced\|Letter of Credit\|Fully Supported\|Fully Supported\|Self Enhanced\|Letter of Credit\|Self Enhanced\|Letter of Credit\|Self Enhanced\|Letter of Credit\|Self Enha...` |
| `value` | `varchar` | `"1.0000"` |
| `valueofsecurityexcludingvalueofcapitalsupportagreement` | `varchar` | `"649976.52\|149915.00\|499968.88\|499963.05\|499945.55\|899879.75\|549851.04\|499820.83\|449998.50\|599939.33\|699822.08\|259995.66\|999858.33\|359938.50\|299956.25\|509895.87\|749831.25\|289853.06\|749893.75\|649998...` |

### n_mfp12

document_types: `N-MFP1`, `N-MFP1/A`, `N-MFP2`, `N-MFP2/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `3015816000280` |
| `filingdate` | `varchar` | `"2016-05-03"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-05-03/n_mfp12/000003015816000280.parquet"` |
| `_table` | `varchar` | `"n_mfp12"` |
| `administratorname` | `varchar` | `"none"` |
| `adviserfilenumber` | `varchar` | `"801-08147"` |
| `advisername` | `varchar` | `"Dreyfus Corporation"` |
| `amortizedcostportfoliosecurities` | `varchar` | `"882812140.42"` |
| `averagelifematurity` | `varchar` | `"63"` |
| `averageportfoliomaturity` | `varchar` | `"22"` |
| `cash` | `varchar` | `"714684.40"` |
| `ccc` | `varchar` | `"XXXXXXXX"` |
| `cik` | `varchar` | `"0000030158"` |
| `city` | `varchar` | `"New York"` |
| `feederfundcik` | `varchar` | `null` |
| `feederfundflag` | `varchar` | `"N"` |
| `feederfundseriesid` | `varchar` | `null` |
| `filenumber` | `varchar` | `null` |
| `filercredentialscik` | `varchar` | `"0000030158"` |
| `finalfilingflag` | `varchar` | `"N"` |
| `fridayday1` | `varchar` | `null` |
| `fridayday2` | `varchar` | `null` |
| `fridayday3` | `varchar` | `null` |
| `fridayday4` | `varchar` | `null` |
| `fridayday5` | `varchar` | `null` |
| `fundacqrdormrgdwthanthrflag` | `varchar` | `"N"` |
| `fundexemptretailflag` | `varchar` | `"N"` |
| `fundliquidatingflag` | `varchar` | `"Y"` |
| `fundmrgoracqrdbyothrflag` | `varchar` | `"N"` |
| `indppubaccountantname` | `varchar` | `"Ernst & Young"` |
| `masterfeederfundcik` | `varchar` | `null` |
| `masterfeederfundname` | `varchar` | `null` |
| `masterfeederfundseriesid` | `varchar` | `null` |
| `masterfundflag` | `varchar` | `"N"` |
| `moneymarketfundcategory` | `varchar` | `"Prime"` |
| `name` | `varchar` | `null` |
| `nameofsigningofficer` | `varchar` | `"John Delise"` |
| `netassetofseries` | `varchar` | `"883197434.12"` |
| `netassetvaluefridayweek1` | `varchar` | `"0.9996"` |
| `netassetvaluefridayweek2` | `varchar` | `"0.9996"` |
| `netassetvaluefridayweek3` | `varchar` | `"0.9996"` |
| `netassetvaluefridayweek4` | `varchar` | `"0.9996"` |
| `netassetvaluefridayweek5` | `varchar` | `"0.9996"` |
| `percentagedailyliquidassetsfridayweek1` | `varchar` | `"0.3827"` |
| `percentagedailyliquidassetsfridayweek2` | `varchar` | `"0.3873"` |
| `percentagedailyliquidassetsfridayweek3` | `varchar` | `"0.3538"` |
| `percentagedailyliquidassetsfridayweek4` | `varchar` | `"0.3541"` |
| `percentagedailyliquidassetsfridayweek5` | `varchar` | `"0.4680"` |
| `percentageweeklyliquidassetsfridayweek1` | `varchar` | `"0.4218"` |
| `percentageweeklyliquidassetsfridayweek2` | `varchar` | `"0.5080"` |
| `percentageweeklyliquidassetsfridayweek3` | `varchar` | `"0.4305"` |
| `percentageweeklyliquidassetsfridayweek4` | `varchar` | `"0.3814"` |
| `percentageweeklyliquidassetsfridayweek5` | `varchar` | `"0.5438"` |
| `registrant` | `varchar` | `"Dreyfus Liquid Assets, Inc."` |
| `registrantleiid` | `varchar` | `null` |
| `reportdate` | `varchar` | `"2016-04-29"` |
| `securitiesactfilenumber` | `varchar` | `"002-49073"` |
| `seriesfundinsucmpnysepaccntflag` | `varchar` | `"N"` |
| `seriesid` | `varchar` | `"S000000074"` |
| `serieslevelinfonumberofsharesoutstanding` | `varchar` | `"883602467.60"` |
| `sevendaygrossyield` | `varchar` | `"0.0055"` |
| `signature` | `varchar` | `"/S/John Delise"` |
| `signaturedate` | `varchar` | `"2016-05-03"` |
| `stablepricepershare` | `varchar` | `"1.0000"` |
| `statecountry` | `varchar` | `"NY"` |
| `subadviseradviserfilenumber` | `varchar` | `"801-55959"` |
| `subadviseradvisername` | `varchar` | `"Principal Global Investors, LLC"` |
| `submissiontype` | `varchar` | `"N-MFP1"` |
| `titleofsigningofficer` | `varchar` | `"Treasury Manager"` |
| `totalshareclassesinseries` | `varchar` | `"3"` |
| `totalvaluedailyliquidassetsfridayday1` | `varchar` | `null` |
| `totalvaluedailyliquidassetsfridayday2` | `varchar` | `null` |
| `totalvaluedailyliquidassetsfridayday3` | `varchar` | `null` |
| `totalvaluedailyliquidassetsfridayday4` | `varchar` | `null` |
| `totalvaluedailyliquidassetsfridayday5` | `varchar` | `null` |
| `totalvaluedailyliquidassetsfridayweek1` | `varchar` | `"343034244.20"` |
| `totalvaluedailyliquidassetsfridayweek2` | `varchar` | `"346593300.26"` |
| `totalvaluedailyliquidassetsfridayweek3` | `varchar` | `"323143017.39"` |
| `totalvaluedailyliquidassetsfridayweek4` | `varchar` | `"323524818.36"` |
| `totalvaluedailyliquidassetsfridayweek5` | `varchar` | `"413713869.12"` |
| `totalvalueliabilities` | `varchar` | `"844739.37"` |
| `totalvalueotherassets` | `varchar` | `"1230033.13"` |
| `totalvalueportfoliosecurities` | `varchar` | `"882812140.42"` |
| `totalvalueweeklyliquidassetsfridayweek1` | `varchar` | `"378034244.20"` |
| `totalvalueweeklyliquidassetsfridayweek2` | `varchar` | `"454591841.93"` |
| `totalvalueweeklyliquidassetsfridayweek3` | `varchar` | `"393142589.61"` |
| `totalvalueweeklyliquidassetsfridayweek4` | `varchar` | `"348524818.36"` |
| `totalvalueweeklyliquidassetsfridayweek5` | `varchar` | `"480710777.45"` |
| `transferagentcik` | `varchar` | `"0001285911"` |
| `transferagentfilenumber` | `varchar` | `"084-06102"` |
| `transferagentname` | `varchar` | `"Dreyfus Transfer Inc"` |

### n_mfp12_class_level_info

document_types: `N-MFP1`, `N-MFP1/A`, `N-MFP2`, `N-MFP2/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `3015816000280` |
| `filingdate` | `varchar` | `"2016-05-03"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-05-03/n_mfp12_class_level_info/000003015816000280.parquet"` |
| `_table` | `varchar` | `"n_mfp12_class_level_info"` |
| `classesid` | `varchar` | `"C000000111"` |
| `fridayweek1` | `varchar` | `"0.9996"` |
| `fridayweek2` | `varchar` | `"0.9996"` |
| `fridayweek2weeklygrossredemptions` | `varchar` | `"5058279.47"` |
| `fridayweek2weeklygrosssubscriptions` | `varchar` | `"4354784.82"` |
| `fridayweek3` | `varchar` | `"0.9996"` |
| `fridayweek3weeklygrossredemptions` | `varchar` | `"6808264.13"` |
| `fridayweek3weeklygrosssubscriptions` | `varchar` | `"4299840.32"` |
| `fridayweek4` | `varchar` | `"0.9996"` |
| `fridayweek4weeklygrossredemptions` | `varchar` | `"7176767.60"` |
| `fridayweek4weeklygrosssubscriptions` | `varchar` | `"2388596.95"` |
| `fridayweek5` | `varchar` | `"0.9996"` |
| `fridayweek5weeklygrossredemptions` | `varchar` | `"5667106.18"` |
| `fridayweek5weeklygrosssubscriptions` | `varchar` | `"2596262.86"` |
| `mininitialinvestment` | `varchar` | `"2500.00"` |
| `nameofpersondescexpensepay` | `varchar` | `"Dreyfus"` |
| `netassetsofclass` | `varchar` | `"530691460.55"` |
| `numberofsharesoutstanding` | `varchar` | `"530995364.21"` |
| `personpayforfundflag` | `varchar` | `"Y"` |
| `sevendaynetyield` | `varchar` | `"0.0001"` |
| `totalforthemonthreportedweeklygrossredemptions` | `varchar` | `"25317799.81"` |
| `totalforthemonthreportedweeklygrosssubscriptions` | `varchar` | `"15355766.37"` |
| `weeklygrossredemptions` | `varchar` | `"607382.43"` |
| `weeklygrosssubscriptions` | `varchar` | `"1716281.42"` |

### n_mfp12_portfolio_security

document_types: `N-MFP1`, `N-MFP1/A`, `N-MFP2`, `N-MFP2/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `3015816000280` |
| `filingdate` | `varchar` | `"2016-05-03"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-05-03/n_mfp12_portfolio_security/000003015816000280.parquet"` |
| `_table` | `varchar` | `"n_mfp12_portfolio_security"` |
| `amountprovidedbydemandfeatureissuer` | `varchar` | `null` |
| `amountprovidedbyenhancement` | `varchar` | `"1.0000"` |
| `amountprovidedbyguarantor` | `varchar` | `"1.0000"` |
| `briefdescription` | `varchar` | `"EURO TIME DEPOSIT-CAYMAN"` |
| `cusipmember` | `varchar` | `"06417GHQ4"` |
| `collateralissuersleiid` | `varchar` | `"BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11\|BFXS5XCH7N0Y05NIXW11"` |
| `couponoryield` | `varchar` | `"1.875\|1.375\|2.000\|1.875\|2.250\|2.000\|1.500\|1.375"` |
| `creditratingdesignatednrsro` | `varchar` | `"F1+\|P-1\|A-1"` |
| `ctgryinvestmentsrprsntscollateral` | `varchar` | `"U.S. Treasuries (including strips)\|U.S. Treasuries (including strips)\|U.S. Treasuries (including strips)\|U.S. Treasuries (including strips)\|U.S. Treasuries (including strips)\|U.S. Treasuries (incl...` |
| `dailyliquidassetsecurityflag` | `varchar` | `"N"` |
| `date` | `varchar` | `"2017-10-31\|2020-09-30\|2020-09-30\|2020-06-30\|2021-03-31\|2021-02-28\|2019-02-28\|2020-01-31"` |
| `demandfeatureconditionalflag` | `varchar` | `null` |
| `demandfeatureratingornrsronameofnrsro` | `varchar` | `null` |
| `demandfeatureratingornrsrorating` | `varchar` | `null` |
| `designatednrsrodemandfeaturecreditratingdesignatednrsro` | `varchar` | `null` |
| `designatednrsrodemandfeaturenameofdesignatednrsro` | `varchar` | `null` |
| `designatednrsroenhancementcreditratingdesignatednrsro` | `varchar` | `"F1\|P-1\|A-1"` |
| `designatednrsroenhancementnameofdesignatednrsro` | `varchar` | `"FITCH'S RATING\|MOODY'S RATING\|S&P RATING"` |
| `designatednrsroguarantorcreditratingdesignatednrsro` | `varchar` | `"NR\|NR\|A-1+"` |
| `designatednrsroguarantornameofdesignatednrsro` | `varchar` | `"FITCH'S RATING\|MOODY'S RATING\|S&P RATING"` |
| `enhancementratingornrsronameofnrsro` | `varchar` | `null` |
| `enhancementratingornrsrorating` | `varchar` | `null` |
| `excludingvalueofanysponsorsupport` | `varchar` | `"34993840.00"` |
| `explanatorynotes` | `varchar` | `"- N/A -"` |
| `finallegalinvestmentmaturitydate` | `varchar` | `"2017-04-13"` |
| `from` | `varchar` | `null` |
| `fundacqstnundrlyngsecurityflag` | `varchar` | `"Y"` |
| `guarantorratingornrsronameofnrsro` | `varchar` | `null` |
| `guarantorratingornrsrorating` | `varchar` | `null` |
| `isinid` | `varchar` | `"136068"` |
| `identityofdemandfeatureissuer` | `varchar` | `null` |
| `identityoftheenhancementprovider` | `varchar` | `"SOCIETE GENERALE"` |
| `identityoftheguarantor` | `varchar` | `"CAISSE DE DEPOT ET PLACEMENT DU QUEBEC"` |
| `illiquidsecurityflag` | `varchar` | `"N"` |
| `includingvalueofanysponsorsupport` | `varchar` | `"34993840.00"` |
| `investmentcategory` | `varchar` | `"Certificate of Deposit"` |
| `investmentmaturitydatewal` | `varchar` | `"2017-04-13"` |
| `investmentmaturitydatewam` | `varchar` | `"2016-05-13"` |
| `leiid` | `varchar` | `"BFXS5XCH7N0Y05NIXW11"` |
| `nameofcollateralissuer` | `varchar` | `"UNITED STATES TREAS NTS-U.S. Treasuries (including strips)\|UNITED STATES TREAS NTS-U.S. Treasuries (including strips)\|UNITED STATES TREAS NTS-U.S. Treasuries (including strips)\|UNITED STATES TREAS...` |
| `nameofdesignatednrsro` | `varchar` | `"FITCH'S RATING\|MOODY'S RATING\|S&P RATING"` |
| `nameofissuer` | `varchar` | `"BANK OF NOVA SCOTIA"` |
| `nameofnrsro` | `varchar` | `null` |
| `otherinstrumentbriefdesc` | `varchar` | `null` |
| `otheruniqueid` | `varchar` | `null` |
| `percentageofmoneymarketfundnetassets` | `varchar` | `"0.0396"` |
| `principalamounttothenearestcent` | `varchar` | `"32240.00\|1724000.00\|14840000.00\|5240000.00\|260292.00\|8800000.00\|3180000.00\|5600000.00"` |
| `rating` | `varchar` | `null` |
| `remainingperioddemandfeature` | `varchar` | `null` |
| `repurchaseagreementopenflag` | `varchar` | `"N"` |
| `scheduleofportfoliosecuritiesinfocik` | `varchar` | `"0000800030"` |
| `securitycategorizedatlevel3flag` | `varchar` | `"N"` |
| `securitydemandfeatureflag` | `varchar` | `"N"` |
| `securityeligibilityflag` | `varchar` | `null` |
| `securityenhancementsflag` | `varchar` | `"N"` |
| `securityguaranteeflag` | `varchar` | `"N"` |
| `securityrated` | `varchar` | `"First Tier Security"` |
| `titleofissuer` | `varchar` | `"BANK OF NOVA SCOTIA"` |
| `to` | `varchar` | `null` |
| `totalvalueoffundposition` | `varchar` | `"34993840.00"` |
| `typeofenhancement` | `varchar` | `"Fully Supported"` |
| `valueofcollateraltothenearestcent` | `varchar` | `"33097.37\|1736000.00\|15320000.00\|5400000.00\|272346.84\|9120000.00\|3236000.00\|5680000.00"` |
| `weeklyliquidassetsecurityflag` | `varchar` | `"N"` |
| `yieldofthesecurityasofreportingdate` | `varchar` | `"0.0099"` |

### n_mfp3

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554924041818` |
| `filingdate` | `varchar` | `"2024-07-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-02/n_mfp3/000114554924041818.parquet"` |
| `_table` | `varchar` | `"n_mfp3"` |
| `administratorname` | `varchar` | `"PENN MUTUAL ASSET MANAGEMENT, LLC\|PENN MUTUAL LIFE INSURANCE CO."` |
| `amortizedcostportfoliosecurities` | `varchar` | `"137729685.13"` |
| `assetbackedcommercialpaperamt` | `varchar` | `"0.00"` |
| `averagelifematurity` | `varchar` | `"21"` |
| `averageportfoliomaturity` | `varchar` | `"21"` |
| `cash` | `varchar` | `"0.00"` |
| `cashmgmtvehicleaffliatedfundflag` | `varchar` | `"N"` |
| `ccc` | `varchar` | `"XXXXXXXX"` |
| `certificatedepositamt` | `varchar` | `"0.00"` |
| `cik` | `varchar` | `"0000702340"` |
| `city` | `varchar` | `"Philadelphia"` |
| `dailynetassetvaluepersharedateseries` | `varchar` | `"2024-06-03\|2024-06-04\|2024-06-05\|2024-06-06\|2024-06-07\|2024-06-10\|2024-06-11\|2024-06-12\|2024-06-13\|2024-06-14\|2024-06-17\|2024-06-18\|2024-06-20\|2024-06-21\|2024-06-24\|2024-06-25\|2024-06-26\|2024-06-2...` |
| `dailynetassetvaluepershareseries` | `varchar` | `"1.0001\|1.0000\|1.0000\|1.0001\|0.9999\|1.0001\|1.0000\|1.0001\|1.0001\|0.9999\|1.0001\|1.0000\|1.0001\|0.9999\|1.0001\|1.0001\|1.0001\|1.0001\|0.9999"` |
| `depositionustreasurydebtamt` | `varchar` | `"0.00"` |
| `feederfundcik` | `varchar` | `null` |
| `feederfundflag` | `varchar` | `"N"` |
| `feederfundseriesid` | `varchar` | `null` |
| `filenumber` | `varchar` | `null` |
| `filercredentialscik` | `varchar` | `"0000702340"` |
| `finalfilingflag` | `varchar` | `"N"` |
| `financialcompanycommercialamt` | `varchar` | `"0.00"` |
| `fundacqrdormrgdwthanthrflag` | `varchar` | `"N"` |
| `fundretailmoneymarketflag` | `varchar` | `"N"` |
| `govmoneymrktfundflag` | `varchar` | `"Y"` |
| `govtagencycouponpayingdebtamt` | `varchar` | `"0.00"` |
| `govtagencynoncouponpayingdebtamt` | `varchar` | `"0.00"` |
| `indppubaccountantname` | `varchar` | `"KPMG LLP"` |
| `insurancecompanyfundagreementamt` | `varchar` | `"0.00"` |
| `investmentcompanyamt` | `varchar` | `"0.00"` |
| `leiofseries` | `varchar` | `"549300GLJSCMRCVZWX45"` |
| `liquidityfeefundapplyflag` | `varchar` | `"N"` |
| `masterfeederfundcik` | `varchar` | `null` |
| `masterfeederfundname` | `varchar` | `null` |
| `masterfeederfundseriesid` | `varchar` | `null` |
| `masterfundflag` | `varchar` | `"N"` |
| `moneymarketfundcategory` | `varchar` | `"Government"` |
| `name` | `varchar` | `null` |
| `nameofseries` | `varchar` | `"Penn Series Funds, Inc."` |
| `nameofsigningofficer` | `varchar` | `"Steven Viola"` |
| `netassetofseries` | `varchar` | `"137183394.91"` |
| `nonfinancialcompanycommercialamt` | `varchar` | `"0.00"` |
| `nonnegotiabletimedepositamt` | `varchar` | `"0.00"` |
| `nonussovereignsupranationaldebtamt` | `varchar` | `"0.00"` |
| `otherassetbackedsecuritiesamt` | `varchar` | `"0.00"` |
| `otherinstrumentamt` | `varchar` | `"0.00"` |
| `otherinstrumentbriefdescription` | `varchar` | `null` |
| `othermunicipalsecurityamt` | `varchar` | `"0.00"` |
| `otherrepurchaseagreementamt` | `varchar` | `"0.00"` |
| `percentagedailyliquidassets` | `varchar` | `"0.3125\|0.4519\|0.4153\|0.3779\|0.3108\|0.3111\|0.3130\|0.3118\|0.3236\|0.3611\|0.2891\|0.2876\|0.3239\|0.3602\|0.3596\|0.4302\|0.3583\|0.3626\|0.3622"` |
| `percentageweeklyliquidassets` | `varchar` | `"0.9094\|0.9086\|0.9085\|0.8358\|0.9769\|0.9769\|0.9053\|0.9768\|0.9258\|0.9778\|0.9053\|0.9777\|0.9776\|0.9776\|0.9775\|0.9774\|0.9047\|0.9775\|0.9775"` |
| `registrant` | `varchar` | `"Penn Series Money Market Fund"` |
| `registrantfullname` | `varchar` | `"Penn Series Money Market Fund"` |
| `registrantleiid` | `varchar` | `"549300D7SWTALBULTE89"` |
| `reportdate` | `varchar` | `"2024-06-28"` |
| `securitiesactfilenumber` | `varchar` | `"002-77284"` |
| `seekstablepricepershare` | `varchar` | `"Y"` |
| `seriesfundinsucmpnysepaccntflag` | `varchar` | `"Y"` |
| `seriesid` | `varchar` | `"S000006722"` |
| `serieslevelinfonumberofsharesoutstanding` | `varchar` | `"137163166.8400"` |
| `signature` | `varchar` | `"Steven Viola"` |
| `signaturedate` | `varchar` | `"2024-07-02"` |
| `stablepricepershare` | `varchar` | `"1.0000"` |
| `statecountry` | `varchar` | `"PA"` |
| `submissiontype` | `varchar` | `"N-MFP3"` |
| `tenderoptionbondamt` | `varchar` | `"0.00"` |
| `titleofsigningofficer` | `varchar` | `"Treasurer"` |
| `totalliquidassetsnearpercentdate` | `varchar` | `"2024-06-03\|2024-06-04\|2024-06-05\|2024-06-06\|2024-06-07\|2024-06-10\|2024-06-11\|2024-06-12\|2024-06-13\|2024-06-14\|2024-06-17\|2024-06-18\|2024-06-20\|2024-06-21\|2024-06-24\|2024-06-25\|2024-06-26\|2024-06-2...` |
| `totalshareclassesinseries` | `varchar` | `"1"` |
| `totalvaluedailyliquidassets` | `varchar` | `"43358882.57\|62176013.30\|57075301.13\|51832023.53\|42993994.60\|43058038.11\|43403189.65\|43169042.33\|44439831.46\|49604895.42\|39759675.96\|39479212.82\|44453389.46\|49462901.54\|49350367.47\|58810677.44\|4905...` |
| `totalvalueliabilities` | `varchar` | `"658693.02"` |
| `totalvalueotherassets` | `varchar` | `"112402.80"` |
| `totalvalueportfoliosecurities` | `varchar` | `"137692249.49"` |
| `totalvalueweeklyliquidassets` | `varchar` | `"126190963.00\|125020216.91\|124860114.05\|114626770.75\|135115401.90\|135192019.09\|125549744.28\|135256570.62\|127139927.84\|134317769.87\|124484960.13\|134197294.22\|134185336.13\|134234260.70\|134134136.35\|1...` |
| `transferagentcik` | `varchar` | `"0000849542"` |
| `transferagentfilenumber` | `varchar` | `"084-01761"` |
| `transferagentname` | `varchar` | `"BNY Mellon Investment Servicing (US) Inc"` |
| `usgovtagencyrepurchaseagreementamt` | `varchar` | `"0.00"` |
| `ustreasuryrepurchaseagreementamt` | `varchar` | `"0.00"` |
| `variableratedemandnoteamt` | `varchar` | `"0.00"` |

### n_mfp3_acquired_merged_fund

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `125889724000175` |
| `filingdate` | `varchar` | `"2024-08-07"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-08-07/n_mfp3_acquired_merged_fund/000125889724000175.parquet"` |
| `_table` | `varchar` | `"n_mfp3_acquired_merged_fund"` |
| `feederfundcik` | `varchar` | `"0000856517"` |
| `feederfundseriesid` | `varchar` | `"S000009575"` |
| `filenumber` | `varchar` | `"033-31602"` |

### n_mfp3_adviser

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554924041818` |
| `filingdate` | `varchar` | `"2024-07-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-02/n_mfp3_adviser/000114554924041818.parquet"` |
| `_table` | `varchar` | `"n_mfp3_adviser"` |
| `adviserfilenumber` | `varchar` | `"801-35477"` |
| `advisername` | `varchar` | `"Penn Mutual Asset Management, LLC"` |

### n_mfp3_class_level_info

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554924041818` |
| `filingdate` | `varchar` | `"2024-07-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-02/n_mfp3_class_level_info/000114554924041818.parquet"` |
| `_table` | `varchar` | `"n_mfp3_class_level_info"` |
| `beneficialrecordownercategorytype` | `varchar` | `"Insurance company\|Insurance company"` |
| `cancelledsharedate` | `varchar` | `"2024-06-03\|2024-06-04\|2024-06-05\|2024-06-06\|2024-06-07\|2024-06-10\|2024-06-11\|2024-06-12\|2024-06-13\|2024-06-14\|2024-06-17\|2024-06-18\|2024-06-20\|2024-06-21\|2024-06-24\|2024-06-25\|2024-06-26\|2024-06-2...` |
| `cancelledsharedollarvalue` | `varchar` | `"0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00\|0.00"` |
| `cancelledsharenumber` | `varchar` | `"0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000\|0.0000"` |
| `classfullname` | `varchar` | `"TF"` |
| `classesid` | `varchar` | `"C000018285"` |
| `dailygrossredemptions` | `varchar` | `"422977.41\|1186674.50\|136524.78\|333472.31\|22.92\|65041.00\|257788.93\|236926.72\|1159657.77\|12399.24\|10422.84\|299249.77\|28739.93\|8171.96\|114950.85\|544057.15\|22.87\|3933.49\|78577.95"` |
| `dailygrosssubscriptions` | `varchar` | `"569285.98\|0.00\|1.04\|25022.82\|1102590.84\|127814.62\|527105.52\|0.00\|0.00\|0.00\|126035.10\|14397.70\|0.00\|8934.33\|0.00\|0.00\|203142.30\|925602.45\|0.00"` |
| `dailynetassetvaluepershareclass` | `varchar` | `"1.0001\|1.0000\|1.0000\|1.0001\|0.9999\|1.0001\|1.0000\|1.0001\|1.0001\|0.9999\|1.0001\|1.0000\|1.0001\|0.9999\|1.0001\|1.0001\|1.0001\|1.0001\|0.9999"` |
| `dailynetassetvaluepersharedateclass` | `varchar` | `"2024-06-03\|2024-06-04\|2024-06-05\|2024-06-06\|2024-06-07\|2024-06-10\|2024-06-11\|2024-06-12\|2024-06-13\|2024-06-14\|2024-06-17\|2024-06-18\|2024-06-20\|2024-06-21\|2024-06-24\|2024-06-25\|2024-06-26\|2024-06-2...` |
| `dailyshareholderflowdate` | `varchar` | `"2024-06-03\|2024-06-04\|2024-06-05\|2024-06-06\|2024-06-07\|2024-06-10\|2024-06-11\|2024-06-12\|2024-06-13\|2024-06-14\|2024-06-17\|2024-06-18\|2024-06-20\|2024-06-21\|2024-06-24\|2024-06-25\|2024-06-26\|2024-06-2...` |
| `mininitialinvestment` | `varchar` | `"1.00"` |
| `nameofpersondescexpensepay` | `varchar` | `"0.00"` |
| `netassetsofclass` | `varchar` | `"137183394.91"` |
| `numberofsharesoutstanding` | `varchar` | `"137163166.8400"` |
| `otherinvestorcategory` | `varchar` | `"Other"` |
| `otherinvestortypedescription` | `varchar` | `"Other"` |
| `percentoutstandingsharesbeneficial` | `varchar` | `"0.00\|0.00"` |
| `percentoutstandingsharesrecord` | `varchar` | `"0.7519\|0.2291"` |
| `percentshareholdercompbrokerdealer` | `varchar` | `"0.0000"` |
| `percentshareholdercompdepositoryinst` | `varchar` | `"0.0000"` |
| `percentshareholdercompinsurance` | `varchar` | `"0.0000"` |
| `percentshareholdercompmunicipal` | `varchar` | `"0.0000"` |
| `percentshareholdercompnonfinancialcorp` | `varchar` | `"0.0000"` |
| `percentshareholdercompnonprofit` | `varchar` | `"0.0000"` |
| `percentshareholdercompother` | `varchar` | `"0.0000"` |
| `percentshareholdercomppensionplan` | `varchar` | `"0.0000"` |
| `percentshareholdercompprivatefunds` | `varchar` | `"0.0000"` |
| `percentshareholdercompreginvestment` | `varchar` | `"0.0000"` |
| `percentshareholdercompsovereignfund` | `varchar` | `"0.0000"` |
| `personpayforfundflag` | `varchar` | `"N"` |
| `sevendaynetyielddate` | `varchar` | `"2024-06-03\|2024-06-04\|2024-06-05\|2024-06-06\|2024-06-07\|2024-06-10\|2024-06-11\|2024-06-12\|2024-06-13\|2024-06-14\|2024-06-17\|2024-06-18\|2024-06-20\|2024-06-21\|2024-06-24\|2024-06-25\|2024-06-26\|2024-06-2...` |
| `sevendaynetyieldvalue` | `varchar` | `"0.0476\|0.0476\|0.0476\|0.0476\|0.0475\|0.0475\|0.0475\|0.0475\|0.0475\|0.0475\|0.0475\|0.0476\|0.0476\|0.0476\|0.0476\|0.0476\|0.0476\|0.0476\|0.0476"` |
| `sharecancellationreportingperiod` | `varchar` | `"N"` |
| `totalgrossredemptions` | `varchar` | `"4899612.39"` |
| `totalgrosssubscriptions` | `varchar` | `"3629932.70"` |

### n_mfp3_portfolio_security

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `207169126013227` |
| `filingdate` | `varchar` | `"2026-06-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2026-06-05/n_mfp3_portfolio_security/000207169126013227.parquet"` |
| `_table` | `varchar` | `"n_mfp3_portfolio_security"` |
| `amountprovidedbydemandfeatureissuer` | `varchar` | `null` |
| `amountprovidedbyenhancement` | `varchar` | `null` |
| `amountprovidedbyguarantor` | `varchar` | `null` |
| `briefdescription` | `varchar` | `null` |
| `cusipmember` | `varchar` | `"89152FFS9"` |
| `collateralissuerscusipmember` | `varchar` | `null` |
| `collateralissuerscoupon` | `varchar` | `null` |
| `collateralissuersleiid` | `varchar` | `null` |
| `coupon` | `varchar` | `"0.00000000"` |
| `ctgryinvestmentsrprsntscollateral` | `varchar` | `null` |
| `dailyliquidassetsecurityflag` | `varchar` | `"N"` |
| `date` | `varchar` | `null` |
| `demandfeatureconditionalflag` | `varchar` | `null` |
| `demandfeatureratingornrsronameofnrsro` | `varchar` | `null` |
| `demandfeatureratingornrsrorating` | `varchar` | `null` |
| `enhancementratingornrsronameofnrsro` | `varchar` | `null` |
| `enhancementratingornrsrorating` | `varchar` | `null` |
| `excludingvalueofanysponsorsupport` | `varchar` | `"49854825.00"` |
| `explanatorynotes` | `varchar` | `null` |
| `finallegalinvestmentmaturitydate` | `varchar` | `"2026-06-26"` |
| `from` | `varchar` | `null` |
| `fundacqstnundrlyngsecurityflag` | `varchar` | `null` |
| `guarantorratingornrsronameofnrsro` | `varchar` | `null` |
| `guarantorratingornrsrorating` | `varchar` | `null` |
| `isinid` | `varchar` | `"US89152FFS92"` |
| `identityofdemandfeatureissuer` | `varchar` | `null` |
| `identityoftheenhancementprovider` | `varchar` | `null` |
| `identityoftheguarantor` | `varchar` | `null` |
| `illiquidsecurityflag` | `varchar` | `"N"` |
| `includingvalueofanysponsorsupport` | `varchar` | `"49854825.00"` |
| `investmentcategory` | `varchar` | `"Non-Financial Company Commercial Paper"` |
| `investmentmaturitydatewal` | `varchar` | `"2026-06-26"` |
| `investmentmaturitydatewam` | `varchar` | `"2026-06-26"` |
| `leiid` | `varchar` | `"529900QI55ZLJVCMPA71"` |
| `nameofccp` | `varchar` | `null` |
| `nameofcollateralissuer` | `varchar` | `null` |
| `nameofissuer` | `varchar` | `"TotalEnergies Capital SA"` |
| `nameofnrsro` | `varchar` | `null` |
| `otherinstrumentbriefdesc` | `varchar` | `null` |
| `otheruniqueid` | `varchar` | `null` |
| `percentageofmoneymarketfundnetassets` | `varchar` | `"0.0085"` |
| `principalamounttothenearestcent` | `varchar` | `null` |
| `rating` | `varchar` | `null` |
| `remainingperioddemandfeature` | `varchar` | `null` |
| `repurchaseagreementclearedflag` | `varchar` | `null` |
| `repurchaseagreementopenflag` | `varchar` | `null` |
| `repurchaseagreementtripartyflag` | `varchar` | `null` |
| `scheduleofportfoliosecuritiesinfocik` | `varchar` | `null` |
| `securitycategorizedatlevel3flag` | `varchar` | `"N"` |
| `securitydemandfeatureflag` | `varchar` | `"N"` |
| `securityeligibilityflag` | `varchar` | `"Y"` |
| `securityenhancementsflag` | `varchar` | `"N"` |
| `securityguaranteeflag` | `varchar` | `"N"` |
| `titleofissuer` | `varchar` | `"TotalEnergies Capital SA"` |
| `to` | `varchar` | `null` |
| `typeofenhancement` | `varchar` | `null` |
| `valueofcollateraltothenearestcent` | `varchar` | `null` |
| `weeklyliquidassetsecurityflag` | `varchar` | `"N"` |
| `yield` | `varchar` | `null` |
| `yieldofthesecurityasofreportingdate` | `varchar` | `"0.0371"` |

### n_mfp3_seven_day_gross_yield

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554924041818` |
| `filingdate` | `varchar` | `"2024-07-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-02/n_mfp3_seven_day_gross_yield/000114554924041818.parquet"` |
| `_table` | `varchar` | `"n_mfp3_seven_day_gross_yield"` |
| `sevendaygrossyielddate` | `varchar` | `"2024-06-03"` |
| `sevendaygrossyieldvalue` | `varchar` | `"0.0534"` |

### n_mfp3_sub_adviser

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554924042299` |
| `filingdate` | `varchar` | `"2024-07-05"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-05/n_mfp3_sub_adviser/000114554924042299.parquet"` |
| `_table` | `varchar` | `"n_mfp3_sub_adviser"` |
| `subadviseradviserfilenumber` | `varchar` | `"801-47710"` |
| `subadviseradvisername` | `varchar` | `"BlackRock Advisors, LLC"` |

### n_mfp3_successor_fund

document_types: `N-MFP3`, `N-MFP3/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554924047671` |
| `filingdate` | `varchar` | `"2024-08-07"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-08-07/n_mfp3_successor_fund/000114554924047671.parquet"` |
| `_table` | `varchar` | `"n_mfp3_successor_fund"` |
| `feederfundcik` | `varchar` | `"0001081400"` |
| `feederfundseriesid` | `varchar` | `"S000007421"` |
| `filenumber` | `varchar` | `"333-74295"` |

### n_px

document_types: `N-PX`, `N-PX/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `106299324013157` |
| `filingdate` | `varchar` | `"2024-07-01"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-01/n_px/000106299324013157.parquet"` |
| `_table` | `varchar` | `"n_px"` |
| `agentcity` | `varchar` | `"Westwood"` |
| `agentname` | `varchar` | `"Eric Sneider"` |
| `agentstateorcountry` | `varchar` | `"MA"` |
| `agentstreet1` | `varchar` | `"Bromfield Sneider Wealth Advisors"` |
| `agentstreet2` | `varchar` | `"200 Lowder Brook Drive, Suite 2600"` |
| `agentzipcode` | `varchar` | `"02090"` |
| `amendmentno` | `varchar` | `null` |
| `amendmenttype` | `varchar` | `null` |
| `city` | `varchar` | `"Westwood"` |
| `confdeniedexpired` | `varchar` | `null` |
| `confidentialtreatment` | `varchar` | `"N"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `coverfilenumber` | `varchar` | `"028-21447"` |
| `dateexpireddenied` | `varchar` | `null` |
| `datereported` | `varchar` | `null` |
| `explanatorychoice` | `varchar` | `"N"` |
| `explanatorynotes` | `varchar` | `null` |
| `filenumber` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001891795"` |
| `investmentcompanytype` | `varchar` | `null` |
| `isamendment` | `varchar` | `null` |
| `leinumber` | `varchar` | `null` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `noticeexplanation` | `varchar` | `"REPORTING PERSON HAS POLICY TO NOT VOTE"` |
| `otherincludedmanagerscount` | `varchar` | `"0"` |
| `overrideinternetflag` | `varchar` | `"true"` |
| `periodofreport` | `varchar` | `"06/30/2024"` |
| `reasonfornonconfidentiality` | `varchar` | `null` |
| `registranttype` | `varchar` | `"IM"` |
| `reportcalendaryear` | `varchar` | `"2024"` |
| `reportquarteryear` | `varchar` | `null` |
| `reporttype` | `varchar` | `"INSTITUTIONAL MANAGER NOTICE REPORT"` |
| `reportingcrdnumber` | `varchar` | `"125623"` |
| `reportingpersonname` | `varchar` | `"Bromfield Sneider Wealth Advisors"` |
| `reportingpersonphone` | `varchar` | `"617-252-3400"` |
| `reportingsecfilenumber` | `varchar` | `"801-122536"` |
| `seriescount` | `varchar` | `null` |
| `signaturereportingperson` | `varchar` | `"Bromfield Sneider Wealth Advisors"` |
| `stateorcountry` | `varchar` | `"MA"` |
| `street1` | `varchar` | `"200 Lowder Brook Drive"` |
| `street2` | `varchar` | `"Suite 2600"` |
| `submissiontype` | `varchar` | `"N-PX"` |
| `txasofdate` | `varchar` | `"06/24/2024"` |
| `txprintedsignature` | `varchar` | `"Eric Sneider"` |
| `txsignature` | `varchar` | `"Eric Sneider"` |
| `txtitle` | `varchar` | `"Vice President"` |
| `yearorquarter` | `varchar` | `"YEAR"` |
| `zipcode` | `varchar` | `"02090"` |

### n_px_investment_manager

document_types: `N-PX`, `N-PX/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `176639224000004` |
| `filingdate` | `varchar` | `"2024-07-08"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-08/n_px_investment_manager/000176639224000004.parquet"` |
| `_table` | `varchar` | `"n_px_investment_manager"` |
| `crdnumber` | `varchar` | `"128473"` |
| `form13ffilenumber` | `varchar` | `"028-00290"` |
| `leinumber` | `varchar` | `"969500YXMX6ZAENXSP27"` |
| `name` | `varchar` | `"Syquant Capital"` |
| `secfilenumber` | `varchar` | `"801-62367"` |
| `serialno` | `varchar` | `"1"` |

### n_px_other_manager

document_types: `N-PX`, `N-PX/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `108514624003006` |
| `filingdate` | `varchar` | `"2024-07-15"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-15/n_px_other_manager/000108514624003006.parquet"` |
| `_table` | `varchar` | `"n_px_other_manager"` |
| `crdnumber` | `varchar` | `"000119904"` |
| `icaor13ffilenumber` | `varchar` | `"811-21237"` |
| `leinumber` | `varchar` | `"549300NFHRL589EP7U13"` |
| `managername` | `varchar` | `"Unified Series Trust"` |
| `otherfilenumber` | `varchar` | `"333-100654"` |

### n_px_secondary_record

document_types: `N-PX`, `N-PX/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `106299324013641` |
| `filingdate` | `varchar` | `"2024-07-10"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-10/n_px_secondary_record/000106299324013641.parquet"` |
| `_table` | `varchar` | `"n_px_secondary_record"` |
| `printedsign` | `varchar` | `"Jared Margolies"` |
| `txasofdate` | `varchar` | `"07/10/2024"` |
| `txsignature` | `varchar` | `"Jared Margolies"` |
| `txtitle` | `varchar` | `"CCO"` |

### n_px_series

document_types: `N-PX`, `N-PX/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `116204424000643` |
| `filingdate` | `varchar` | `"2024-07-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-07-02/n_px_series/000116204424000643.parquet"` |
| `_table` | `varchar` | `"n_px_series"` |
| `idofseries` | `varchar` | `"S000011589"` |
| `leiofseries` | `varchar` | `"549300Q7HIUTPQYL3D48"` |
| `nameofseries` | `varchar` | `"NorthQuest Capital Fund INC."` |

### ncr

document_types: `N-CR`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `139834425012105` |
| `filingdate` | `varchar` | `"2025-06-23"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2025-06-23/ncr/000139834425012105.parquet"` |
| `_table` | `varchar` | `"ncr"` |
| `contractrestrictionsdesc` | `varchar` | `"None"` |
| `dateofdailyassets` | `varchar` | `"06/20/2025"` |
| `factsdescription` | `varchar` | `"Due to an error, the Fund purchased a Federal Home Loan Bank discount note maturing in two days in an amount that caused the Fund's daily liquid assets to drop below 12.5% on June 20, 2025. As of ...` |
| `filenumber` | `varchar` | `"033-82366"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001843841"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `optionaldisclosure` | `varchar` | `"The Fund experienced no redemption activity on 6/20/2025 and the liquidity threshold event had no implications on the Fund's ability to meet shareholder redemptions. Had the liquidity threshold ev...` |
| `percentageofdailyassets` | `varchar` | `"0.0027"` |
| `percentageofweeklyassets` | `varchar` | `"0.9985"` |
| `periodofreport` | `varchar` | `"00/00/0000"` |
| `reasondescription` | `varchar` | `"One time capital contribution to bring the Fund's NAV to $1.000000"` |
| `registrantcik` | `varchar` | `"0001843841"` |
| `registrantlei` | `varchar` | `"529900OKAQTILEJ47M71"` |
| `registrantname` | `varchar` | `"DGI Investment Trust"` |
| `relationshipdescription` | `varchar` | `"MML Investment Advisers, LLC is the investment adviser to the fund."` |
| `reportdate` | `varchar` | `"06/23/2025"` |
| `schemaversion` | `varchar` | `"X0101"` |
| `seriesid` | `varchar` | `"S000091773"` |
| `serieslei` | `varchar` | `"529900K1KHLFPONTY627"` |
| `seriesname` | `varchar` | `"DGI U.S. Government Money Market Fund"` |
| `signature` | `varchar` | `"/s/ Alfonso J. Cuesta"` |
| `signaturedate` | `varchar` | `"06/23/2025"` |
| `signaturename` | `varchar` | `"DGI Investment Trust"` |
| `signaturetitle` | `varchar` | `"Assistant Secretary"` |
| `submissiontype` | `varchar` | `"N-CR"` |
| `supportamtdescription` | `varchar` | `"202028.47"` |
| `supportdate` | `varchar` | `"08/14/2025"` |
| `supportdescription` | `varchar` | `"A capital contribution in connection with the liquidation of the fund."` |
| `supportpersonname` | `varchar` | `"MML Investment Advisers, LLC"` |
| `termofsupport` | `varchar` | `"Once"` |

### nport_p

document_types: `NPORT-P`, `NPORT-P/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554919039203` |
| `filingdate` | `varchar` | `"2019-10-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-10-22/nport_p/000114554919039203.parquet"` |
| `_table` | `varchar` | `"nport_p"` |
| `aggregateconditionisnoncashcollateral` | `varchar` | `null` |
| `amt` | `varchar` | `null` |
| `amtpayaftoneyrbanksborr` | `varchar` | `"0.000000000000"` |
| `amtpayaftoneyrctrldcomp` | `varchar` | `"0.000000000000"` |
| `amtpayaftoneyrothaffil` | `varchar` | `"0.000000000000"` |
| `amtpayaftoneyrother` | `varchar` | `"0.000000000000"` |
| `amtpayoneyrbanksborr` | `varchar` | `"0.000000000000"` |
| `amtpayoneyrctrldcomp` | `varchar` | `"0.000000000000"` |
| `amtpayoneyrothaffil` | `varchar` | `"0.000000000000"` |
| `amtpayoneyrother` | `varchar` | `"0.000000000000"` |
| `assetsattrmiscsec` | `varchar` | `"0.000000000000"` |
| `assetsinvested` | `varchar` | `"0.000000000000"` |
| `backtestingresults` | `varchar` | `null` |
| `ccc` | `varchar` | `"XXXXXXXX"` |
| `cik` | `varchar` | `"0001000351"` |
| `classid` | `varchar` | `"C000002464"` |
| `collatrl` | `varchar` | `null` |
| `creditcontractsfuturecategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `creditcontractsfuturecategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `creditcontractsfuturecategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `creditcontractsfuturecategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `creditcontractsfuturecategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `creditcontractsfuturecategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `creditcontractsmon1netrealizedgain` | `varchar` | `"-89.200000000000"` |
| `creditcontractsmon1netunrealizedappr` | `varchar` | `"1004.780000000000"` |
| `creditcontractsmon2netrealizedgain` | `varchar` | `"2292.690000000000"` |
| `creditcontractsmon2netunrealizedappr` | `varchar` | `"-1004.780000000000"` |
| `creditcontractsmon3netrealizedgain` | `varchar` | `"N/A"` |
| `creditcontractsmon3netunrealizedappr` | `varchar` | `"N/A"` |
| `creditcontractsoptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `creditcontractsoptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `creditcontractsoptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `creditcontractsoptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `creditcontractsoptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `creditcontractsoptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `creditcontractsothercategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `creditcontractsothercategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `creditcontractsothercategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `creditcontractsothercategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `creditcontractsothercategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `creditcontractsothercategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `creditcontractsswapcategoryinstrmon1netrealizedgain` | `varchar` | `"-89.200000000000"` |
| `creditcontractsswapcategoryinstrmon1netunrealizedappr` | `varchar` | `"1004.780000000000"` |
| `creditcontractsswapcategoryinstrmon2netrealizedgain` | `varchar` | `"2292.690000000000"` |
| `creditcontractsswapcategoryinstrmon2netunrealizedappr` | `varchar` | `"-1004.780000000000"` |
| `creditcontractsswapcategoryinstrmon3netrealizedgain` | `varchar` | `"N/A"` |
| `creditcontractsswapcategoryinstrmon3netunrealizedappr` | `varchar` | `"N/A"` |
| `creditcontractsswaptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `creditcontractsswaptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `creditcontractsswaptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `creditcontractsswaptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `creditcontractsswaptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `creditcontractsswaptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `creditcontractswarrantcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `creditcontractswarrantcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `creditcontractswarrantcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `creditcontractswarrantcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `creditcontractswarrantcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `creditcontractswarrantcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `creditsprdrisknoninvstgradeperiod10yr` | `varchar` | `"90.440000000000"` |
| `creditsprdrisknoninvstgradeperiod1yr` | `varchar` | `"11823.010000000000"` |
| `creditsprdrisknoninvstgradeperiod30yr` | `varchar` | `"0.000000000000"` |
| `creditsprdrisknoninvstgradeperiod3mon` | `varchar` | `"0.000000000000"` |
| `creditsprdrisknoninvstgradeperiod5yr` | `varchar` | `"42260.560000000000"` |
| `cshnotrptdincord` | `varchar` | `"111047893.540000000000"` |
| `datesigned` | `varchar` | `"2019-10-21"` |
| `delaydeliv` | `varchar` | `"0.000000000000"` |
| `derivcurrencyexposurepct` | `varchar` | `null` |
| `derivexposurepct` | `varchar` | `null` |
| `derivintrateexposurepct` | `varchar` | `null` |
| `documents` | `varchar` | `"XXXX"` |
| `equitycontractsforwardcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `equitycontractsforwardcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `equitycontractsforwardcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `equitycontractsforwardcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `equitycontractsforwardcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `equitycontractsforwardcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `equitycontractsfuturecategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `equitycontractsfuturecategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `equitycontractsfuturecategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `equitycontractsfuturecategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `equitycontractsfuturecategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `equitycontractsfuturecategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `equitycontractsmon1netrealizedgain` | `varchar` | `"230227"` |
| `equitycontractsmon1netunrealizedappr` | `varchar` | `"6161"` |
| `equitycontractsmon2netrealizedgain` | `varchar` | `"386602"` |
| `equitycontractsmon2netunrealizedappr` | `varchar` | `"-1800776"` |
| `equitycontractsmon3netrealizedgain` | `varchar` | `"-1272510"` |
| `equitycontractsmon3netunrealizedappr` | `varchar` | `"1440601"` |
| `equitycontractsoptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `equitycontractsoptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `equitycontractsoptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `equitycontractsoptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `equitycontractsoptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `equitycontractsoptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `equitycontractsothercategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `equitycontractsothercategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `equitycontractsothercategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `equitycontractsothercategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `equitycontractsothercategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `equitycontractsothercategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `equitycontractsswapcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `equitycontractsswapcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `equitycontractsswapcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `equitycontractsswapcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `equitycontractsswapcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `equitycontractsswapcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `equitycontractsswaptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `equitycontractsswaptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `equitycontractsswaptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `equitycontractsswaptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `equitycontractsswaptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `equitycontractsswaptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `equitycontractswarrantcategoryinstrmon1netrealizedgain` | `varchar` | `"N/A"` |
| `equitycontractswarrantcategoryinstrmon1netunrealizedappr` | `varchar` | `"1815260.11"` |
| `equitycontractswarrantcategoryinstrmon2netrealizedgain` | `varchar` | `"N/A"` |
| `equitycontractswarrantcategoryinstrmon2netunrealizedappr` | `varchar` | `"-20243.72"` |
| `equitycontractswarrantcategoryinstrmon3netrealizedgain` | `varchar` | `"N/A"` |
| `equitycontractswarrantcategoryinstrmon3netunrealizedappr` | `varchar` | `"-1795016.39"` |
| `foreignexchgcontractsforwardcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsforwardcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsforwardcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsforwardcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsforwardcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsforwardcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsfuturecategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsfuturecategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsfuturecategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsfuturecategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsfuturecategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsfuturecategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsoptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsoptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsoptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsoptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsoptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsoptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsothercategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsothercategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsothercategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsothercategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsothercategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsothercategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsswapcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsswapcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsswapcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsswapcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsswapcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsswapcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsswaptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsswaptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsswaptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsswaptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractsswaptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractsswaptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractswarrantcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractswarrantcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractswarrantcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractswarrantcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `foreignexchgcontractswarrantcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `foreignexchgcontractswarrantcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `forwardcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `forwardcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `forwardcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `forwardcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `forwardcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `forwardcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `futurecategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `futurecategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `futurecategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `futurecategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `futurecategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `futurecategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `indexidentifier` | `varchar` | `null` |
| `instrmon1netrealizedgain` | `varchar` | `null` |
| `instrmon1netunrealizedappr` | `varchar` | `null` |
| `instrmon2netrealizedgain` | `varchar` | `null` |
| `instrmon2netunrealizedappr` | `varchar` | `null` |
| `instrmon3netrealizedgain` | `varchar` | `null` |
| `instrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsforwardcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsforwardcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsforwardcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsforwardcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsforwardcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsforwardcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsfuturecategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsfuturecategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsfuturecategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsfuturecategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsfuturecategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsfuturecategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsoptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsoptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsoptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsoptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsoptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsoptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsothercategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsothercategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsothercategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsothercategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsothercategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsothercategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsswapcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsswapcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsswapcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsswapcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsswapcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsswapcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsswaptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsswaptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsswaptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsswaptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractsswaptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractsswaptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractswarrantcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `interestrtcontractswarrantcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractswarrantcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `interestrtcontractswarrantcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `interestrtcontractswarrantcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `interestrtcontractswarrantcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `invstcat` | `varchar` | `null` |
| `invstcatconditionalinvstcat` | `varchar` | `null` |
| `invstcatconditionalotherdesc` | `varchar` | `null` |
| `isconfidential` | `varchar` | `"false"` |
| `isfinalfiling` | `varchar` | `"N"` |
| `isnoncashcollateral` | `varchar` | `"N"` |
| `liquidpref` | `varchar` | `"0.000000000000"` |
| `mediandailyvarpct` | `varchar` | `null` |
| `medianvarratiopct` | `varchar` | `null` |
| `mon1netrealizedgain` | `varchar` | `null` |
| `mon1netunrealizedappr` | `varchar` | `null` |
| `mon2flowredemption` | `varchar` | `"-7999165.840000000000"` |
| `mon2flowreinvestment` | `varchar` | `".000000000000"` |
| `mon2flowsales` | `varchar` | `"11704952.260000000000"` |
| `mon2netrealizedgain` | `varchar` | `null` |
| `mon2netunrealizedappr` | `varchar` | `null` |
| `mon3flowredemption` | `varchar` | `"-4878332.200000000000"` |
| `mon3flowreinvestment` | `varchar` | `"201594.730000000000"` |
| `mon3flowsales` | `varchar` | `"3331699.260000000000"` |
| `mon3netrealizedgain` | `varchar` | `null` |
| `mon3netunrealizedappr` | `varchar` | `null` |
| `monthlytotreturnclassid` | `varchar` | `"C000002464"` |
| `namedesignatedindex` | `varchar` | `null` |
| `nameofapplicant` | `varchar` | `"Leuthold Funds Inc"` |
| `netassets` | `varchar` | `"92368414.460000000000"` |
| `netrealizedgain` | `varchar` | `"-720742.690000000000"` |
| `netunrealizedappr` | `varchar` | `"-466570.110000000000"` |
| `noofbusinessdaysinexcess` | `varchar` | `null` |
| `optioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `optioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `optioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `optioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `optioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `optioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othmon2netrealizedgain` | `varchar` | `"66571.800000000000"` |
| `othmon2netunrealizedappr` | `varchar` | `"5803577.210000000000"` |
| `othmon3netrealizedgain` | `varchar` | `"-3262648.780000000000"` |
| `othmon3netunrealizedappr` | `varchar` | `"-89439.470000000000"` |
| `othercategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsforwardcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsforwardcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsforwardcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsforwardcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsforwardcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsforwardcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsfuturecategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsfuturecategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsfuturecategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsfuturecategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsfuturecategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsfuturecategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsoptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsoptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsoptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsoptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsoptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsoptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsothercategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsothercategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsothercategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsothercategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsothercategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsothercategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsswapcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsswapcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsswapcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsswapcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsswapcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsswapcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractsswaptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractsswaptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractsswaptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractsswaptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractsswaptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractsswaptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `othercontractswarrantcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `othercontractswarrantcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `othercontractswarrantcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `othercontractswarrantcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `othercontractswarrantcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `othercontractswarrantcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `otherdesc` | `varchar` | `null` |
| `period10yr` | `varchar` | `"0.000000000000"` |
| `period1yr` | `varchar` | `"0.000000000000"` |
| `period30yr` | `varchar` | `"0.000000000000"` |
| `period3mon` | `varchar` | `"0.000000000000"` |
| `period5yr` | `varchar` | `"0.000000000000"` |
| `redemption` | `varchar` | `"-4965567.360000000000"` |
| `regcik` | `varchar` | `"0001000351"` |
| `regcity` | `varchar` | `"Minneapolis"` |
| `regcountry` | `varchar` | `null` |
| `regfilenumber` | `varchar` | `"811-09094"` |
| `reglei` | `varchar` | `"5493003DRVWH4DTZGC15"` |
| `regname` | `varchar` | `"Leuthold Funds Inc"` |
| `regphone` | `varchar` | `"612-332-9141"` |
| `regstate` | `varchar` | `"US-MN"` |
| `regstateconditionalregcountry` | `varchar` | `"US"` |
| `regstreet1` | `varchar` | `"150 S. Fifth Street"` |
| `regstreet2` | `varchar` | `"Suite 1700"` |
| `regziporpostalcode` | `varchar` | `"55402"` |
| `reinvestment` | `varchar` | `".000000000000"` |
| `reppddate` | `varchar` | `"2019-09-30"` |
| `reppdend` | `varchar` | `"2019-09-30"` |
| `rtn1` | `varchar` | `"-1.130000000000"` |
| `rtn2` | `varchar` | `"6.820000000000"` |
| `rtn3` | `varchar` | `"-3.450000000000"` |
| `sales` | `varchar` | `"6149098.320000000000"` |
| `seriesclassinfoseriesid` | `varchar` | `"S000000849"` |
| `seriesid` | `varchar` | `"S000000849"` |
| `serieslei` | `varchar` | `"54930064NFL867W3Z804"` |
| `seriesname` | `varchar` | `"Grizzly Short Fund"` |
| `signature` | `varchar` | `"/s/ Roger Peters"` |
| `signername` | `varchar` | `"Roger Peters"` |
| `standbycommit` | `varchar` | `"0.000000000000"` |
| `submissiontype` | `varchar` | `"NPORT-P"` |
| `swapcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `swapcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `swapcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `swapcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `swapcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `swapcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `swaptioncategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `swaptioncategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `swaptioncategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `swaptioncategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `swaptioncategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `swaptioncategoryinstrmon3netunrealizedappr` | `varchar` | `null` |
| `title` | `varchar` | `"Chief Compliance Officer"` |
| `totassets` | `varchar` | `"181905489.100000000000"` |
| `totliabs` | `varchar` | `"89537074.640000000000"` |
| `warrantcategoryinstrmon1netrealizedgain` | `varchar` | `null` |
| `warrantcategoryinstrmon1netunrealizedappr` | `varchar` | `null` |
| `warrantcategoryinstrmon2netrealizedgain` | `varchar` | `null` |
| `warrantcategoryinstrmon2netunrealizedappr` | `varchar` | `null` |
| `warrantcategoryinstrmon3netrealizedgain` | `varchar` | `null` |
| `warrantcategoryinstrmon3netunrealizedappr` | `varchar` | `null` |

### nport_p_borrower

document_types: `NPORT-P`, `NPORT-P/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554919039205` |
| `filingdate` | `varchar` | `"2019-10-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-10-22/nport_p_borrower/000114554919039205.parquet"` |
| `_table` | `varchar` | `"nport_p_borrower"` |
| `aggrval` | `varchar` | `"5972712.700000000000"` |
| `borrowerlei` | `varchar` | `"MRK678VXOI09YSSN8X19"` |
| `borrowername` | `varchar` | `"TD AMERITRADE CLEARING, INC"` |

### nport_p_cur_metric

document_types: `NPORT-P`, `NPORT-P/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554919041055` |
| `filingdate` | `varchar` | `"2019-10-30"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-10-30/nport_p_cur_metric/000114554919041055.parquet"` |
| `_table` | `varchar` | `"nport_p_cur_metric"` |
| `curmetriccurcd` | `varchar` | `"USD"` |
| `intrstrtriskdv01period10yr` | `varchar` | `"0.020000000000"` |
| `intrstrtriskdv01period1yr` | `varchar` | `"0.070000000000"` |
| `intrstrtriskdv01period30yr` | `varchar` | `"0.000000000000"` |
| `intrstrtriskdv01period3mon` | `varchar` | `"0.000000000000"` |
| `intrstrtriskdv01period5yr` | `varchar` | `"0.290000000000"` |
| `intrstrtriskdv100period10yr` | `varchar` | `"2.670000000000"` |
| `intrstrtriskdv100period1yr` | `varchar` | `"7.270000000000"` |
| `intrstrtriskdv100period30yr` | `varchar` | `"0.000000000000"` |
| `intrstrtriskdv100period3mon` | `varchar` | `"0.000000000000"` |
| `intrstrtriskdv100period5yr` | `varchar` | `"29.370000000000"` |

### nport_p_explntr_note

document_types: `NPORT-P`, `NPORT-P/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114554919041252` |
| `filingdate` | `varchar` | `"2019-10-30"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2019-10-30/nport_p_explntr_note/000114554919041252.parquet"` |
| `_table` | `varchar` | `"nport_p_explntr_note"` |
| `note` | `varchar` | `"The monthly total returns shown in B.5.a. do not reflect the deduction of sales loads or redemption fees."` |
| `noteitem` | `varchar` | `"B.5.a"` |

### nport_p_invst_or_sec

document_types: `NPORT-P`, `NPORT-P/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `175272425044462` |
| `filingdate` | `varchar` | `"2025-02-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2025-02-27/nport_p_invst_or_sec/000175272425044462.parquet"` |
| `_table` | `varchar` | `"nport_p_invst_or_sec"` |
| `amount` | `varchar` | `null` |
| `amtcurpur` | `varchar` | `null` |
| `amtcursold` | `varchar` | `null` |
| `annualizedrt` | `varchar` | `"5.00000000"` |
| `areintrstpmntsinarrs` | `varchar` | `"N"` |
| `assetcat` | `varchar` | `"DBT"` |
| `assetconditionalassetcat` | `varchar` | `"OTHER"` |
| `balance` | `varchar` | `"615000.00000000"` |
| `cashcollateralconditioniscashcollateral` | `varchar` | `null` |
| `cashcollateralval` | `varchar` | `null` |
| `centralcounterparty` | `varchar` | `null` |
| `collateralcd` | `varchar` | `null` |
| `collateralval` | `varchar` | `null` |
| `componentidentifierscusipvalue` | `varchar` | `null` |
| `componentidentifiersisinvalue` | `varchar` | `null` |
| `componentidentifierstickervalue` | `varchar` | `null` |
| `convratio` | `varchar` | `null` |
| `counterpartiescounterpartylei` | `varchar` | `null` |
| `counterpartiescounterpartyname` | `varchar` | `null` |
| `counterpartyinfolei` | `varchar` | `null` |
| `counterpartyinfoname` | `varchar` | `null` |
| `counterpartylei` | `varchar` | `null` |
| `counterpartyname` | `varchar` | `null` |
| `couponkind` | `varchar` | `"Fixed"` |
| `curcd` | `varchar` | `"USD"` |
| `curpur` | `varchar` | `null` |
| `cursold` | `varchar` | `null` |
| `currencyconditionalcurcd` | `varchar` | `null` |
| `currencyinfocurcd` | `varchar` | `null` |
| `cusip` | `varchar` | `"91588XAG1"` |
| `cusipvalue` | `varchar` | `null` |
| `dbtsecrefinstrumentcurcd` | `varchar` | `null` |
| `dbtsecrefinstrumentname` | `varchar` | `null` |
| `dbtsecrefinstrumenttitle` | `varchar` | `null` |
| `delta` | `varchar` | `null` |
| `derivaddlinfoassetcat` | `varchar` | `null` |
| `derivaddlinfobalance` | `varchar` | `null` |
| `derivaddlinfocurcd` | `varchar` | `null` |
| `derivaddlinfocusip` | `varchar` | `null` |
| `derivaddlinfodescothunits` | `varchar` | `null` |
| `derivaddlinfoidentifiersotherotherdesc` | `varchar` | `null` |
| `derivaddlinfoidentifiersothervalue` | `varchar` | `null` |
| `derivaddlinfoidentifierstickervalue` | `varchar` | `null` |
| `derivaddlinfoinvcountry` | `varchar` | `null` |
| `derivaddlinfoissuercat` | `varchar` | `null` |
| `derivaddlinfoissuerconditionaldesc` | `varchar` | `null` |
| `derivaddlinfoissuerconditionalissuercat` | `varchar` | `null` |
| `derivaddlinfolei` | `varchar` | `null` |
| `derivaddlinfoname` | `varchar` | `null` |
| `derivaddlinfopctval` | `varchar` | `null` |
| `derivaddlinfotitle` | `varchar` | `null` |
| `derivaddlinfounits` | `varchar` | `null` |
| `derivaddlinfovalusd` | `varchar` | `null` |
| `derivcat` | `varchar` | `null` |
| `desc` | `varchar` | `"Investment company"` |
| `descothunits` | `varchar` | `null` |
| `descrefinstrmntindexbasketinfoindexidentifier` | `varchar` | `null` |
| `descrefinstrmntindexbasketinfoindexname` | `varchar` | `null` |
| `descrefinstrmntindexbasketinfonarrativedesc` | `varchar` | `null` |
| `descrefinstrmntotherrefinstidentifierscusipvalue` | `varchar` | `null` |
| `descrefinstrmntotherrefinstidentifiersisinvalue` | `varchar` | `null` |
| `descrefinstrmntotherrefinstidentifiersotherotherdesc` | `varchar` | `null` |
| `descrefinstrmntotherrefinstidentifiersothervalue` | `varchar` | `null` |
| `descrefinstrmntotherrefinstidentifierstickervalue` | `varchar` | `null` |
| `descrefinstrmntotherrefinstissuetitle` | `varchar` | `null` |
| `descrefinstrmntotherrefinstissuername` | `varchar` | `null` |
| `exchangert` | `varchar` | `null` |
| `exerciseprice` | `varchar` | `null` |
| `exercisepricecurcd` | `varchar` | `null` |
| `expdate` | `varchar` | `null` |
| `expdt` | `varchar` | `null` |
| `fairvallevel` | `varchar` | `"2"` |
| `fixedorfloating` | `varchar` | `null` |
| `fixedpmntdescamount` | `varchar` | `null` |
| `fixedpmntdesccurcd` | `varchar` | `null` |
| `fixedpmntdescfixedorfloating` | `varchar` | `null` |
| `fixedpmntdescfixedrt` | `varchar` | `null` |
| `fixedrecdescamount` | `varchar` | `null` |
| `fixedrecdesccurcd` | `varchar` | `null` |
| `fixedrecdescfixedorfloating` | `varchar` | `null` |
| `fixedrecdescfixedrt` | `varchar` | `null` |
| `fixedrt` | `varchar` | `null` |
| `floatingpmntdesccurcd` | `varchar` | `null` |
| `floatingpmntdescfixedorfloating` | `varchar` | `null` |
| `floatingpmntdescfloatingrtindex` | `varchar` | `null` |
| `floatingpmntdescfloatingrtspread` | `varchar` | `null` |
| `floatingpmntdescpmntamt` | `varchar` | `null` |
| `floatingrecdesccurcd` | `varchar` | `null` |
| `floatingrecdescfixedorfloating` | `varchar` | `null` |
| `floatingrecdescfloatingrtindex` | `varchar` | `null` |
| `floatingrecdescfloatingrtspread` | `varchar` | `null` |
| `floatingrecdescpmntamt` | `varchar` | `null` |
| `floatingrecdescrtresettenorsrtresettenorratetenor` | `varchar` | `null` |
| `floatingrecdescrtresettenorsrtresettenorratetenorunit` | `varchar` | `null` |
| `floatingrecdescrtresettenorsrtresettenorresetdt` | `varchar` | `null` |
| `floatingrecdescrtresettenorsrtresettenorresetdtunit` | `varchar` | `null` |
| `floatingrtindex` | `varchar` | `null` |
| `floatingrtspread` | `varchar` | `null` |
| `futrderivcounterpartiescounterpartylei` | `varchar` | `null` |
| `futrderivcounterpartiescounterpartyname` | `varchar` | `null` |
| `futrderivcurcd` | `varchar` | `null` |
| `futrderivderivcat` | `varchar` | `null` |
| `futrderivdescrefinstrmntindexbasketinfoindexidentifier` | `varchar` | `null` |
| `futrderivdescrefinstrmntindexbasketinfoindexname` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstidentifierscusipvalue` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstidentifiersisinvalue` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstidentifiersotherotherdesc` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstidentifiersothervalue` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstidentifierstickervalue` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstissuetitle` | `varchar` | `null` |
| `futrderivdescrefinstrmntotherrefinstissuername` | `varchar` | `null` |
| `futrderivexpdate` | `varchar` | `null` |
| `futrderivnotionalamt` | `varchar` | `null` |
| `futrderivpayoffprof` | `varchar` | `null` |
| `fwdderivamtcurpur` | `varchar` | `null` |
| `fwdderivamtcursold` | `varchar` | `null` |
| `fwdderivcounterpartiescounterpartylei` | `varchar` | `null` |
| `fwdderivcounterpartiescounterpartyname` | `varchar` | `null` |
| `fwdderivcurpur` | `varchar` | `null` |
| `fwdderivcursold` | `varchar` | `null` |
| `fwdderivderivaddlinfoassetcat` | `varchar` | `null` |
| `fwdderivderivaddlinfobalance` | `varchar` | `null` |
| `fwdderivderivaddlinfocurcd` | `varchar` | `null` |
| `fwdderivderivaddlinfocusip` | `varchar` | `null` |
| `fwdderivderivaddlinfoidentifiersotherotherdesc` | `varchar` | `null` |
| `fwdderivderivaddlinfoidentifiersothervalue` | `varchar` | `null` |
| `fwdderivderivaddlinfoinvcountry` | `varchar` | `null` |
| `fwdderivderivaddlinfoissuerconditionaldesc` | `varchar` | `null` |
| `fwdderivderivaddlinfoissuerconditionalissuercat` | `varchar` | `null` |
| `fwdderivderivaddlinfolei` | `varchar` | `null` |
| `fwdderivderivaddlinfoname` | `varchar` | `null` |
| `fwdderivderivaddlinfopctval` | `varchar` | `null` |
| `fwdderivderivaddlinfotitle` | `varchar` | `null` |
| `fwdderivderivaddlinfounits` | `varchar` | `null` |
| `fwdderivderivaddlinfovalusd` | `varchar` | `null` |
| `fwdderivderivcat` | `varchar` | `null` |
| `fwdderivsettlementdt` | `varchar` | `null` |
| `fwdderivunrealizedappr` | `varchar` | `null` |
| `identifierscusipvalue` | `varchar` | `null` |
| `identifiersisinvalue` | `varchar` | `null` |
| `identifiersotherotherdesc` | `varchar` | `null` |
| `identifiersothervalue` | `varchar` | `null` |
| `identifierstickervalue` | `varchar` | `null` |
| `indexbasketinfoindexidentifier` | `varchar` | `null` |
| `indexbasketinfoindexname` | `varchar` | `null` |
| `indexbasketinfonarrativedesc` | `varchar` | `null` |
| `indexname` | `varchar` | `null` |
| `invcountry` | `varchar` | `"US"` |
| `invothcountry` | `varchar` | `null` |
| `invstcatconditionaldesc` | `varchar` | `null` |
| `invstorsectitle` | `varchar` | `"Upper Illinois River Valley Development Authority"` |
| `iscashcollateral` | `varchar` | `"N"` |
| `iscleared` | `varchar` | `null` |
| `iscontngtconvrtbl` | `varchar` | `null` |
| `isdefault` | `varchar` | `"N"` |
| `isloanbyfund` | `varchar` | `"N"` |
| `ismandatoryconvrtbl` | `varchar` | `null` |
| `ispaidkind` | `varchar` | `"N"` |
| `isrestrictedsec` | `varchar` | `"Y"` |
| `istriparty` | `varchar` | `null` |
| `isinvalue` | `varchar` | `null` |
| `issuetitle` | `varchar` | `null` |
| `issuercat` | `varchar` | `"MUN"` |
| `issuerconditionaldesc` | `varchar` | `null` |
| `issuerconditionalissuercat` | `varchar` | `null` |
| `issuername` | `varchar` | `null` |
| `lei` | `varchar` | `"N/A"` |
| `loanbyfundconditionisloanbyfund` | `varchar` | `null` |
| `loanval` | `varchar` | `null` |
| `maturitydt` | `varchar` | `"2045-01-01"` |
| `name` | `varchar` | `"Upper Illinois River Valley Development Authority"` |
| `narrativedesc` | `varchar` | `null` |
| `nestedderivinfofutrderivcurcd` | `varchar` | `null` |
| `nestedderivinfofwdderivderivcat` | `varchar` | `null` |
| `nestedderivinfoswapderivcounterpartiescounterpartylei` | `varchar` | `null` |
| `nestedderivinfoswapderivcounterpartiescounterpartyname` | `varchar` | `null` |
| `nestedderivinfoswapderivcurcd` | `varchar` | `null` |
| `nestedderivinfoswapderivderivcat` | `varchar` | `null` |
| `nestedderivinfoswapderivdescrefinstrmntotherrefinstissuetitle` | `varchar` | `null` |
| `nestedderivinfoswapderivdescrefinstrmntotherrefinstissuername` | `varchar` | `null` |
| `nestedderivinfoswapderivnotionalamt` | `varchar` | `null` |
| `nestedderivinfoswapderivterminationdt` | `varchar` | `null` |
| `noncashcollateralconditionisnoncashcollateral` | `varchar` | `null` |
| `noncashcollateralval` | `varchar` | `null` |
| `notclearedcentcpartyiscleared` | `varchar` | `null` |
| `notionalamt` | `varchar` | `null` |
| `notionalamtamt` | `varchar` | `null` |
| `notionalamtcurcd` | `varchar` | `null` |
| `optionswaptionwarrantderivcounterpartiescounterpartylei` | `varchar` | `null` |
| `optionswaptionwarrantderivcounterpartiescounterpartyname` | `varchar` | `null` |
| `optionswaptionwarrantderivcurcd` | `varchar` | `null` |
| `optionswaptionwarrantderivdelta` | `varchar` | `null` |
| `optionswaptionwarrantderivderivcat` | `varchar` | `null` |
| `optionswaptionwarrantderivunrealizedappr` | `varchar` | `null` |
| `othderivcounterpartiescounterpartylei` | `varchar` | `null` |
| `othderivcounterpartiescounterpartyname` | `varchar` | `null` |
| `othderivdelta` | `varchar` | `null` |
| `othderivderivcat` | `varchar` | `null` |
| `othderivdescrefinstrmntotherrefinstidentifiersothervalue` | `varchar` | `null` |
| `othderivunrealizedappr` | `varchar` | `null` |
| `othdesc` | `varchar` | `null` |
| `othindcurcd` | `varchar` | `null` |
| `othindisscurcd` | `varchar` | `null` |
| `othindname` | `varchar` | `null` |
| `othindnotamt` | `varchar` | `null` |
| `othindvalue` | `varchar` | `null` |
| `otherdesc` | `varchar` | `null` |
| `otherotherdesc` | `varchar` | `null` |
| `otherpmntdesc` | `varchar` | `null` |
| `otherpmntdescfixedorfloating` | `varchar` | `null` |
| `otherrecdesc` | `varchar` | `null` |
| `otherrecdescfixedorfloating` | `varchar` | `null` |
| `otherrefinstidentifierscusipvalue` | `varchar` | `null` |
| `otherrefinstidentifiersisinvalue` | `varchar` | `null` |
| `otherrefinstidentifiersotherotherdesc` | `varchar` | `null` |
| `otherrefinstidentifiersothervalue` | `varchar` | `null` |
| `otherrefinstidentifierstickervalue` | `varchar` | `null` |
| `otherrefinstissuetitle` | `varchar` | `null` |
| `otherrefinstissuername` | `varchar` | `null` |
| `othervalue` | `varchar` | `null` |
| `payoffprof` | `varchar` | `null` |
| `payoffprofile` | `varchar` | `"Long"` |
| `pctval` | `varchar` | `"0.048090947152"` |
| `pmntamt` | `varchar` | `null` |
| `pmntcurcd` | `varchar` | `null` |
| `principalamt` | `varchar` | `null` |
| `principalcd` | `varchar` | `null` |
| `putorcall` | `varchar` | `null` |
| `ratetenor` | `varchar` | `null` |
| `ratetenorunit` | `varchar` | `null` |
| `rcptcurcd` | `varchar` | `null` |
| `repurchaseagrmtmaturitydt` | `varchar` | `null` |
| `repurchasecollateralinvstcat` | `varchar` | `null` |
| `repurchasecollateralinvstcatconditionalinvstcat` | `varchar` | `null` |
| `repurchasecollateralprincipalamt` | `varchar` | `null` |
| `repurchasert` | `varchar` | `null` |
| `resetdt` | `varchar` | `null` |
| `resetdtunit` | `varchar` | `null` |
| `rtresettenorratetenor` | `varchar` | `null` |
| `rtresettenorratetenorunit` | `varchar` | `null` |
| `rtresettenorresetdt` | `varchar` | `null` |
| `rtresettenorresetdtunit` | `varchar` | `null` |
| `rtresettenorsrtresettenorratetenor` | `varchar` | `null` |
| `rtresettenorsrtresettenorratetenorunit` | `varchar` | `null` |
| `rtresettenorsrtresettenorresetdt` | `varchar` | `null` |
| `rtresettenorsrtresettenorresetdtunit` | `varchar` | `null` |
| `securitylendingisnoncashcollateral` | `varchar` | `"N"` |
| `settlementdt` | `varchar` | `null` |
| `shareno` | `varchar` | `null` |
| `swapderivamtcurpur` | `varchar` | `null` |
| `swapderivamtcursold` | `varchar` | `null` |
| `swapderivcounterpartiescounterpartylei` | `varchar` | `null` |
| `swapderivcounterpartiescounterpartyname` | `varchar` | `null` |
| `swapderivcurcd` | `varchar` | `null` |
| `swapderivcurpur` | `varchar` | `null` |
| `swapderivcursold` | `varchar` | `null` |
| `swapderivderivaddlinfoassetcat` | `varchar` | `null` |
| `swapderivderivaddlinfobalance` | `varchar` | `null` |
| `swapderivderivaddlinfocurcd` | `varchar` | `null` |
| `swapderivderivaddlinfocusip` | `varchar` | `null` |
| `swapderivderivaddlinfoidentifiersotherotherdesc` | `varchar` | `null` |
| `swapderivderivaddlinfoidentifiersothervalue` | `varchar` | `null` |
| `swapderivderivaddlinfoinvcountry` | `varchar` | `null` |
| `swapderivderivaddlinfoissuercat` | `varchar` | `null` |
| `swapderivderivaddlinfoissuerconditionaldesc` | `varchar` | `null` |
| `swapderivderivaddlinfoissuerconditionalissuercat` | `varchar` | `null` |
| `swapderivderivaddlinfolei` | `varchar` | `null` |
| `swapderivderivaddlinfoname` | `varchar` | `null` |
| `swapderivderivaddlinfopctval` | `varchar` | `null` |
| `swapderivderivaddlinfotitle` | `varchar` | `null` |
| `swapderivderivaddlinfounits` | `varchar` | `null` |
| `swapderivderivaddlinfovalusd` | `varchar` | `null` |
| `swapderivderivcat` | `varchar` | `null` |
| `swapderivdescrefinstrmntindexbasketinfoindexidentifier` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstidentifierscusipvalue` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstidentifiersisinvalue` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstidentifiersotherotherdesc` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstidentifiersothervalue` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstidentifierstickervalue` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstissuetitle` | `varchar` | `null` |
| `swapderivdescrefinstrmntotherrefinstissuername` | `varchar` | `null` |
| `swapderivfixedpmntdesccurcd` | `varchar` | `null` |
| `swapderivfixedrecdescamount` | `varchar` | `null` |
| `swapderivfixedrecdesccurcd` | `varchar` | `null` |
| `swapderivfixedrecdescfixedorfloating` | `varchar` | `null` |
| `swapderivfixedrecdescfixedrt` | `varchar` | `null` |
| `swapderivfloatingpmntdesccurcd` | `varchar` | `null` |
| `swapderivfloatingpmntdescfixedorfloating` | `varchar` | `null` |
| `swapderivfloatingrecdesccurcd` | `varchar` | `null` |
| `swapderivfloatingrecdescfixedorfloating` | `varchar` | `null` |
| `swapderivfloatingrecdescfloatingrtindex` | `varchar` | `null` |
| `swapderivfloatingrecdescfloatingrtspread` | `varchar` | `null` |
| `swapderivfloatingrecdescpmntamt` | `varchar` | `null` |
| `swapderivnotionalamt` | `varchar` | `null` |
| `swapderivpmntcurcd` | `varchar` | `null` |
| `swapderivrcptcurcd` | `varchar` | `null` |
| `swapderivsettlementdt` | `varchar` | `null` |
| `swapderivterminationdt` | `varchar` | `null` |
| `swapderivunrealizedappr` | `varchar` | `null` |
| `swapderivupfrontpmnt` | `varchar` | `null` |
| `swapderivupfrontrcpt` | `varchar` | `null` |
| `swapflag` | `varchar` | `null` |
| `terminationdt` | `varchar` | `null` |
| `tickervalue` | `varchar` | `null` |
| `transcat` | `varchar` | `null` |
| `units` | `varchar` | `"PA"` |
| `unrealizedappr` | `varchar` | `null` |
| `upfrontpmnt` | `varchar` | `null` |
| `upfrontrcpt` | `varchar` | `null` |
| `valusd` | `varchar` | `"596843.36000000"` |
| `value` | `varchar` | `"US91588XAG16"` |
| `writtenorpur` | `varchar` | `null` |

### proxy_voting_record

document_types: `PROXY VOTING RECORD`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `119312526374898` |
| `filingdate` | `varchar` | `"2026-08-31"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2026-08-31/proxy_voting_record/000119312526374898.parquet"` |
| `_table` | `varchar` | `"proxy_voting_record"` |
| `categorytype` | `varchar` | `"AUDIT-RELATED"` |
| `cusip` | `varchar` | `"G06940103"` |
| `figi` | `varchar` | `null` |
| `howvoted` | `varchar` | `"FOR"` |
| `isin` | `varchar` | `"GB0002634946"` |
| `issuername` | `varchar` | `"BAE Systems Plc"` |
| `managementrecommendation` | `varchar` | `"FOR"` |
| `meetingdate` | `varchar` | `"05/07/2026"` |
| `othervotedescription` | `varchar` | `null` |
| `sharesonloan` | `varchar` | `"0"` |
| `sharesvoted` | `varchar` | `"99016.000000"` |
| `votedescription` | `varchar` | `"Reappoint Deloitte LLP as Auditors"` |
| `votemanagerothermanager` | `varchar` | `null` |
| `voteotherinfo` | `varchar` | `null` |
| `voterecordsharesvoted` | `varchar` | `"99016.000000"` |
| `voteseries` | `varchar` | `"S000033730"` |
| `votesource` | `varchar` | `"ISSUER"` |

### qualif

document_types: `QUALIF`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `999999999415000001` |
| `filingdate` | `varchar` | `"2015-08-31"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2015-08-31/qualif/999999999415000001.parquet"` |
| `_table` | `varchar` | `"qualif"` |
| `act` | `varchar` | `"33"` |
| `cik` | `varchar` | `"0001588504"` |
| `entityname` | `varchar` | `"GROUNDFLOOR FINANCE INC."` |
| `filenumber` | `varchar` | `"024-10440"` |
| `finaleffectivenessdispdate` | `varchar` | `"2015-08-31"` |
| `finaleffectivenessdisptime` | `varchar` | `"16:00:00"` |
| `form` | `varchar` | `"1-A"` |
| `submissiontype` | `varchar` | `"QUALIF"` |

### sbse_c

document_types: `SBSE`, `SBSE-A`, `SBSE-A/A`, `SBSE-BD`, `SBSE-BD/A`, `SBSE-C`, `SBSE-W`, `SBSE/A`, `SBSEF`, `SBSEF-W`, `SBSEF/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `1961721000449` |
| `filingdate` | `varchar` | `"2021-10-21"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2021-10-21/sbse_c/000001961721000449.parquet"` |
| `_table` | `varchar` | `"sbse_c"` |
| `addresscity` | `varchar` | `null` |
| `addressstateorcountry` | `varchar` | `null` |
| `addressstreet1` | `varchar` | `null` |
| `addresszipcode` | `varchar` | `null` |
| `amendeditemslist` | `varchar` | `null` |
| `applicantaddresscity` | `varchar` | `"Garden City\|Red Bank\|Stamford"` |
| `applicantaddressstateorcountry` | `varchar` | `"NY\|NJ\|CT"` |
| `applicantaddressstreet1` | `varchar` | `"1010 Franklin Ave,\|2 Bridge Avenue\|262 Harbor Dr."` |
| `applicantaddressstreet2` | `varchar` | `"Ste 303\|Ste 131 3rd Floor\|2nd Floor"` |
| `applicantaddresszipcode` | `varchar` | `"11530\|07701\|06902"` |
| `applicantcik` | `varchar` | `"0001274981"` |
| `applicantdatapagefiveapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `applicantdatapagefiveisforeignregulatory` | `varchar` | `"N"` |
| `applicantdatapagefourapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `applicantdatapageoneapplicantcik` | `varchar` | `"0001771015"` |
| `applicantdatapageoneapplicantuic` | `varchar` | `"549300KKMNDUVLY8OR56"` |
| `applicantdatapageonebusinesstelephonenumber` | `varchar` | `"6465621000"` |
| `applicantdatapageonechiefcomplianceofficeremailaddress` | `varchar` | `"linda.messinger@cowen.com"` |
| `applicantdatapageonechiefcomplianceofficerphone` | `varchar` | `"6465621866"` |
| `applicantdatapageonechiefcomplianceofficertitle` | `varchar` | `"Chief Compliance Officer"` |
| `applicantdatapageonecontactemployeetitle` | `varchar` | `"Chief Compliance Officer"` |
| `applicantdatapageonefullapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `applicantdatapageonemainaddresscity` | `varchar` | `"NEW YORK"` |
| `applicantdatapageonemainaddressstateorcountry` | `varchar` | `"NY"` |
| `applicantdatapageonemainaddressstreet1` | `varchar` | `"599 LEXINGTON AVENUE"` |
| `applicantdatapageonemainaddresszipcode` | `varchar` | `"10022"` |
| `applicantdatapageonewebsiteurl` | `varchar` | `"www.cowen.com"` |
| `applicantdatapagethreeapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `applicantdatapagethreeiscontrolthroughagreement` | `varchar` | `"Y"` |
| `applicantdatapagethreeisonbehalf` | `varchar` | `"Y"` |
| `applicantdatapagethreeisrecordskept` | `varchar` | `"Y"` |
| `applicantdatapagethreeiswhollyorpartiallyfinance` | `varchar` | `"Y"` |
| `applicantdatapagetwoapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `applicantdatapagetwodescriptionbusiness` | `varchar` | `"Primarily transact in delta one swaps as well as some corporate debt and convertible bond underliers"` |
| `applicantdatapagetwoiscommissiondetermine` | `varchar` | `null` |
| `applicantdatapagetwoisholdfunds` | `varchar` | `"Y"` |
| `applicantdatapagetwoisnonresidententity` | `varchar` | `"N"` |
| `applicantdatapagetwoisselfdetermine` | `varchar` | `null` |
| `applicantdatapagetwoissubjecttoregulator` | `varchar` | `"N"` |
| `applicantdatapagetwoissucceeding` | `varchar` | `"N"` |
| `applicantdatapagetwoisswapdealer` | `varchar` | `"Y"` |
| `applicantdatapagetwoisswapparticipant` | `varchar` | `"N"` |
| `applicantname` | `varchar` | `"NATIXIS"` |
| `applicantnfaid` | `varchar` | `"309904"` |
| `applicantnfano` | `varchar` | `"309904"` |
| `applicantnfanumber` | `varchar` | `"309904"` |
| `applicantonechiefcomplianceofficeremailaddress` | `varchar` | `"ALAIN.BRUNEAU@NATIXIS.COM"` |
| `applicantonechiefcomplianceofficerofficernamefirstname` | `varchar` | `"ALAIN"` |
| `applicantonechiefcomplianceofficerofficernamelastname` | `varchar` | `"BRUNEAU"` |
| `applicantonechiefcomplianceofficerofficernamemiddlename` | `varchar` | `null` |
| `applicantonechiefcomplianceofficerphone` | `varchar` | `"0033158554571"` |
| `applicantonechiefcomplianceofficertitle` | `varchar` | `"CHIEF COMPLIANCE OFFICER"` |
| `applicantonecontactemployeecontactemployeenamefirstname` | `varchar` | `"ELIZABETH"` |
| `applicantonecontactemployeecontactemployeenamelastname` | `varchar` | `"KIM"` |
| `applicantonecontactemployeeemailaddress` | `varchar` | `"ELIZABETH.KIM@NATIXIS.COM"` |
| `applicantonecontactemployeephone` | `varchar` | `"0033158550247"` |
| `applicantonecontactemployeetitle` | `varchar` | `"HEAD OF SD CCO OFFICE"` |
| `applicantonefullapplicantname` | `varchar` | `"NATIXIS"` |
| `applicantoneirsemplidentno` | `varchar` | `"00-0000000"` |
| `applicantonemailingaddresscity` | `varchar` | `"SIOUX FALLS"` |
| `applicantonemailingaddressstateorcountry` | `varchar` | `"SD"` |
| `applicantonemailingaddressstreet1` | `varchar` | `"101 NORTH PHILLIPS AVENUE"` |
| `applicantonemailingaddressstreet2` | `varchar` | `null` |
| `applicantonemailingaddresszipcode` | `varchar` | `"57104"` |
| `applicantonemainaddresscity` | `varchar` | `"PARIS"` |
| `applicantonemainaddressstateorcountry` | `varchar` | `"I0"` |
| `applicantonemainaddressstreet1` | `varchar` | `"30, AVENUE PIERRE MENDES FRANCE"` |
| `applicantonemainaddressstreet2` | `varchar` | `null` |
| `applicantonemainaddresszipcode` | `varchar` | `"75013"` |
| `applicantonewebsiteurl` | `varchar` | `"WWW.NATIXIS.COM"` |
| `applicantthreeapplicantname` | `varchar` | `"NATIXIS"` |
| `applicantthreeapplicantnfano` | `varchar` | `"309904"` |
| `applicantthreeisforeignregulatory` | `varchar` | `"Y"` |
| `applicanttwoapplicantname` | `varchar` | `"NATIXIS"` |
| `applicanttwoapplicantnfano` | `varchar` | `"309904"` |
| `applicanttwoissubjecttoregulator` | `varchar` | `"Y"` |
| `applicanttwoisswapdealer` | `varchar` | `"Y"` |
| `applicanttwoisswapparticipant` | `varchar` | `"N"` |
| `applicanttworegisteredas` | `varchar` | `"Swap Dealer"` |
| `applicantuic` | `varchar` | `"KX1WK48MPD4Y2NCUIZ63"` |
| `assigningregulators` | `varchar` | `"AUTORITE DE CONTROLE PRUDENTIEL (ACP),FRANCE AUTORITE DES MARCHES FINANCIERS(AMF),FRANCE FINANCIAL SERVICES AUTHORITY (FSA) (NATIXIS LONDON BRANCH) BU"` |
| `associatedperson` | `varchar` | `"James Puliafico\|Matthew Baldassano\|Bryan Seyfried"` |
| `businesslocchangeoption` | `varchar` | `"Add\|Add\|Add"` |
| `businessname` | `varchar` | `null` |
| `businesstelephonenumber` | `varchar` | `"011 33 1 58 32 30 00"` |
| `ccc` | `varchar` | `"XXXXXXXX"` |
| `cerapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `cerdate` | `varchar` | `"10-27-2021"` |
| `certificationoneapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `certificationonename` | `varchar` | `"Jeffrey Solomon"` |
| `certificationonesignature` | `varchar` | `"Jeffrey Solomon"` |
| `certificationtwoapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `certificationtwocerapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `certificationtwocerdate` | `varchar` | `"10-27-2021"` |
| `certificationtwoname` | `varchar` | `"Linda Messinger"` |
| `certificationtwosignature` | `varchar` | `"Linda Messinger"` |
| `chargedesc` | `varchar` | `null` |
| `chiefcomplianceofficeremailaddress` | `varchar` | `"joseph.a.cerullo@jpmchase.com"` |
| `chiefcomplianceofficerofficernamefirstname` | `varchar` | `"Linda"` |
| `chiefcomplianceofficerofficernamelastname` | `varchar` | `"Messinger"` |
| `chiefcomplianceofficerofficernamemiddlename` | `varchar` | `"Louise"` |
| `chiefcomplianceofficerphone` | `varchar` | `"212-648-1577"` |
| `chiefcomplianceofficertitle` | `varchar` | `"Chief Compliance Officer"` |
| `cik` | `varchar` | `"0000782124"` |
| `city` | `varchar` | `null` |
| `cityorcounty` | `varchar` | `null` |
| `civiljudicialactiondisclosureisdismissed` | `varchar` | `"N"` |
| `civiljudicialactiondisclosureisenjoined` | `varchar` | `"N"` |
| `civiljudicialactiondisclosureisfoundinviolationofregulation` | `varchar` | `"N"` |
| `civiljudicialactiondisclosureisnamedincivilproceeding` | `varchar` | `"N"` |
| `contactemployeecontactemployeenamefirstname` | `varchar` | `"Linda"` |
| `contactemployeecontactemployeenamelastname` | `varchar` | `"Messinger"` |
| `contactemployeecontactemployeenamemiddlename` | `varchar` | `"Louise"` |
| `contactemployeeemailaddress` | `varchar` | `"linda.messinger@cowen.com"` |
| `contactemployeenamefirstname` | `varchar` | `"Heather"` |
| `contactemployeenamelastname` | `varchar` | `"Emmert"` |
| `contactemployeenamemiddlename` | `varchar` | `null` |
| `contactemployeenameprefix` | `varchar` | `"Ms"` |
| `contactemployeephone` | `varchar` | `"6465621866"` |
| `contactemployeetitle` | `varchar` | `"Executive Director"` |
| `controlaffiliatecontrolaffiliatedetailsfirstname` | `varchar` | `null` |
| `controlaffiliatecontrolaffiliatedetailslastname` | `varchar` | `null` |
| `controlaffiliatedetailscrdnumber` | `varchar` | `"000122529\|000007616\|000014508\|000315686"` |
| `controlaffiliatedetailsfirstname` | `varchar` | `null` |
| `controlaffiliatedetailsispersonregistered` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `controlaffiliatedetailsisshouldberemoved` | `varchar` | `null` |
| `controlaffiliatedetailsissubmittedtocrd` | `varchar` | `"Y\|Y\|Y\|Y"` |
| `controlaffiliatedetailslastname` | `varchar` | `null` |
| `controlaffiliatedetailsmiddlename` | `varchar` | `null` |
| `controlaffiliatedetailspersontype` | `varchar` | `"Firm\|Firm\|Firm\|Firm"` |
| `controlaffiliatedetailsuicnumber` | `varchar` | `"54930031NZWF09VVYY54\|549300WR155U7DVMIW58\|54930026SYDE4SQNDN03\|549300X855XKPWLLMA70"` |
| `controlperson` | `varchar` | `"Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y"` |
| `controlthroughagreementdescriptionarrangement` | `varchar` | `null` |
| `controlthroughagreementdetailscontrolthroughagreementdescriptionarrangement` | `varchar` | `null` |
| `controlthroughagreementdetailscontrolthroughagreementfirmciknumber` | `varchar` | `"0001466538"` |
| `controlthroughagreementdetailscontrolthroughagreementfirmeffectivedate` | `varchar` | `"03-29-2018\|03-29-2018"` |
| `controlthroughagreementdetailscontrolthroughagreementfirmororganizationname` | `varchar` | `"Cowen Inc.\|RCG LV Pearl LLC"` |
| `controlthroughagreementdetailscontrolthroughagreementfirmuic` | `varchar` | `"5493008QI0EFC5WBED75"` |
| `controlthroughagreementdetailscontrolthroughagreementresponsetype` | `varchar` | `"Item 12A\|Item 12A"` |
| `controlthroughagreementfirmaddresscity` | `varchar` | `"New York\|New York"` |
| `controlthroughagreementfirmaddressstateorcountry` | `varchar` | `"NY\|NY"` |
| `controlthroughagreementfirmaddressstreet1` | `varchar` | `"599 Lexington Ave.\|599 Lexington Ave."` |
| `controlthroughagreementfirmaddressstreet2` | `varchar` | `null` |
| `controlthroughagreementfirmaddresszipcode` | `varchar` | `"10022\|10022"` |
| `controlthroughagreementfirmciknumber` | `varchar` | `"0001485022"` |
| `controlthroughagreementfirmeffectivedate` | `varchar` | `"11-17-2006"` |
| `controlthroughagreementfirmforeignbusinessno` | `varchar` | `null` |
| `controlthroughagreementfirmnfa` | `varchar` | `null` |
| `controlthroughagreementfirmorindividual` | `varchar` | `"Firm\|Firm"` |
| `controlthroughagreementfirmororganizationname` | `varchar` | `"BPCE"` |
| `controlthroughagreementfirmuic` | `varchar` | `"LEI-OT19FZZ6Z7A27CCLDY33\|LEI - PBLD0EJDB5FWOLXP3B7"` |
| `controlthroughagreementresponsetype` | `varchar` | `"Item 14"` |
| `controlwithbank` | `varchar` | `null` |
| `countryofdomicile` | `varchar` | `"X0\|X0\|K3"` |
| `countryofformation` | `varchar` | `"X1"` |
| `courttype` | `varchar` | `null` |
| `crdno` | `varchar` | `"000000079"` |
| `crdnumber` | `varchar` | `null` |
| `criminaldisclosureischargedmisdemeanor` | `varchar` | `"N"` |
| `criminaldisclosureischargedwithfelony` | `varchar` | `"N"` |
| `criminaldisclosureisconvictedmisdemeanor` | `varchar` | `"N"` |
| `criminaldisclosureisconvictedoffelony` | `varchar` | `"N"` |
| `criminaldrpdetailsstateorcountry` | `varchar` | `null` |
| `criminaldrpinitialoramended` | `varchar` | `null` |
| `currentstatus` | `varchar` | `null` |
| `date` | `varchar` | `"10-19-2021"` |
| `datebeganworking` | `varchar` | `"04/2014\|01/2007\|02/2003\|02/2016\|01/2020\|09/2018\|06/2010\|01/2017\|05/2009\|01/2016\|05/2021\|03/2015\|01/2013\|06/2020\|01/2017\|04/2018\|04/2017\|08/2019\|05/2018\|01/2013\|08/2013\|06/2020\|03/2016\|09/2021"` |
| `dateceasedbusiness` | `varchar` | `null` |
| `datefirstchargeddate` | `varchar` | `null` |
| `datefirstchargedexactorexplanation` | `varchar` | `null` |
| `dateinitiateddate` | `varchar` | `null` |
| `dateinitiatedexactorexplanation` | `varchar` | `null` |
| `dateofformation` | `varchar` | `"03-29-2018"` |
| `datepaid` | `varchar` | `null` |
| `datetitleorstatusacquired` | `varchar` | `"08/2020\|08/2018\|07/2009\|02/2016\|01/2020\|09/2018\|03/2020\|01/2021\|01/2013\|02/2018\|05/2021\|03/2015\|01/2013\|06/2020\|01/2017\|02/2019\|11/2019\|08/2019\|05/2020\|01/2013\|08/2013\|06/2020\|03/2016\|09/2021"` |
| `descallegations` | `varchar` | `null` |
| `descrelationshipwithapplicant` | `varchar` | `null` |
| `describebusiness` | `varchar` | `"J.P. Morgan Securities LLC is a U.S. securities broker-dealer and investment advisor registered with the Securities and Exchange Commission, a futures commission merchant registered with the Commo...` |
| `description` | `varchar` | `"Natixis' four Lines of Business: 1. Asset Management (Asset Management, Wealth Management, Employee savings schemes), 2. Corporate Investment & Banking (Investment Banking and acquisitions and dis...` |
| `description3c` | `varchar` | `"To satisfy the conditions that the SEC placed on substituted compliance determinations (i.e. MiFID, EMIR, and MAR requirements), Natixis has implemented policies and procedures reasonably designed...` |
| `descriptionarrangement` | `varchar` | `null` |
| `descriptionbusiness` | `varchar` | `"Natixis S.A. offers corporate, investment and financial services. The Bank services companies, financial institutions and institutional investors. Natixis offers wholesale banking in the form of c...` |
| `descriptionrelationship` | `varchar` | `"Under common control of the same ultimate parent Cowen Inc.\|Under common control of the same ultimate parent Cowen Inc.\|Under common control of the same ultimate parent Cowen Inc\|Under common cont...` |
| `dispositiondisclosuredate` | `varchar` | `null` |
| `dispositiontype` | `varchar` | `null` |
| `docketorcasenumber` | `varchar` | `null` |
| `drpfiledfor` | `varchar` | `null` |
| `effecttype` | `varchar` | `null` |
| `effectivedate` | `varchar` | `"09-17-2021\|09-17-2021\|09-17-2021"` |
| `emailaddress` | `varchar` | `"heather.k.emmert@jpmchase.com"` |
| `engagedinsecurities` | `varchar` | `"13A"` |
| `entitytype` | `varchar` | `"DE\|I\|I\|I\|I\|I\|I\|I"` |
| `eventcurrentstatus` | `varchar` | `null` |
| `eventstatusdatedate` | `varchar` | `null` |
| `exactorexplanation` | `varchar` | `null` |
| `executiondate` | `varchar` | `"10-20-2021"` |
| `felonyormisdemeanor` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001274981"` |
| `financialdisclosurehassubjectofbankruptcy` | `varchar` | `"N"` |
| `financialdisclosurehastrusteeappointed` | `varchar` | `"N"` |
| `financialinstitutionname` | `varchar` | `null` |
| `firmaddresscity` | `varchar` | `"Paris"` |
| `firmaddressstateorcountry` | `varchar` | `"I0"` |
| `firmaddressstreet1` | `varchar` | `"50 avenue Pierre Mendes France"` |
| `firmaddressstreet2` | `varchar` | `"11th Floor\|10th Floor\|19th Floor"` |
| `firmaddresszipcode` | `varchar` | `"75201"` |
| `firmciknumber` | `varchar` | `null` |
| `firmcrdno` | `varchar` | `"000126292\|000019801"` |
| `firmeffectivedate` | `varchar` | `"05-07-2014\|07-09-2020\|08-22-2007\|11-30-2015"` |
| `firmforeignbusinessno` | `varchar` | `null` |
| `firmname` | `varchar` | `null` |
| `firmnfa` | `varchar` | `"0000815\|0336875\|0344862"` |
| `firmorindividual` | `varchar` | `null` |
| `firmororganizationname` | `varchar` | `"Bloomberg SEF\|WeMatch\|Equilend / Swaptimization\|ICE Clear Credit LLC"` |
| `firmsecfilenumber` | `varchar` | `"008-65876\|008-39012"` |
| `firmterminationdate` | `varchar` | `null` |
| `firmuic` | `varchar` | `"LEI-VYVVCKR63DVZZN70PB21"` |
| `firstname` | `varchar` | `"NICOLAS\|NATHALIE\|ANDRE JEAN\|ALAIN\|OLIVIER\|VERONIQUE\|MOHAMED\|MICHAEL\|LAURENT\|CATHERINE\|DOMINIQUE\|ANNE\|BERNARD\|CATHERINE\|CATHERINE\|CHRISTOPHE\|DANIEL\|DIANE\|DOMINIQUE\|HENRI\|NICOLAS\|PHILIPPE\|SYLVIE\|LAU...` |
| `foreignfinancialregforeignbusinessno` | `varchar` | `null` |
| `foreignfinancialregulatory` | `varchar` | `"Autorite des Marches Financiers (AMF), Autorite de Controle Prudentiel (ACPR), European Central Bank (ECB)"` |
| `fullapplicantname` | `varchar` | `"J.P. MORGAN SECURITIES LLC"` |
| `fulllegalname` | `varchar` | `"RCG LV Pearl, LLC"` |
| `fullname` | `varchar` | `null` |
| `hassubjectofbankruptcy` | `varchar` | `null` |
| `hastrusteeappointed` | `varchar` | `null` |
| `haveownershipinterest` | `varchar` | `"N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `initialoramended` | `varchar` | `"INITIAL"` |
| `institutionaddresscity` | `varchar` | `null` |
| `institutionaddressstateorcountry` | `varchar` | `null` |
| `institutionaddressstreet1` | `varchar` | `null` |
| `institutionaddressstreet2` | `varchar` | `null` |
| `institutionaddresszipcode` | `varchar` | `null` |
| `institutionname` | `varchar` | `"Cowen Financial Products LLC\|Cowen Financial Products LLC\|Cowen Financial Products LLC"` |
| `institutiontype` | `varchar` | `null` |
| `investmentproducttype` | `varchar` | `null` |
| `irsemplidentno` | `varchar` | `null` |
| `irstaxno` | `varchar` | `"26-0351693"` |
| `isanyindirectowners` | `varchar` | `"Y"` |
| `isauthorizedtoactattorney` | `varchar` | `null` |
| `iscauseofdenial` | `varchar` | `null` |
| `ischargedmisdemeanor` | `varchar` | `null` |
| `ischargedwithfelony` | `varchar` | `null` |
| `iscommissiondetermine` | `varchar` | `"Y"` |
| `iscomplaint` | `varchar` | `null` |
| `iscontrolthroughagreement` | `varchar` | `"Y"` |
| `iscontrolwithbank` | `varchar` | `"N"` |
| `isconvictedmisdemeanor` | `varchar` | `null` |
| `isconvictedoffelony` | `varchar` | `null` |
| `isdeniedlicense` | `varchar` | `null` |
| `isderivativesdealer` | `varchar` | `"N"` |
| `isdisciplined` | `varchar` | `null` |
| `isdismissed` | `varchar` | `null` |
| `iseffecttransactions` | `varchar` | `"N"` |
| `isengageinotherbusiness` | `varchar` | `"Y"` |
| `isengagedininvestmentrelatedbusiness` | `varchar` | `null` |
| `isengagedinnonsecurity` | `varchar` | `"N"` |
| `isengagedinsecurities` | `varchar` | `"Y"` |
| `isenjoined` | `varchar` | `null` |
| `isforeignentity` | `varchar` | `"Y\|Y\|Y\|N\|N\|N\|N\|N\|N\|N\|N"` |
| `isforeignregulatory` | `varchar` | `"N"` |
| `isfoundincauseofdenial` | `varchar` | `null` |
| `isfoundincauseofsuspension` | `varchar` | `null` |
| `isfoundinviolationofregulation` | `varchar` | `null` |
| `isfoundinviolationofrules` | `varchar` | `null` |
| `isfoundmadefalsestatement` | `varchar` | `null` |
| `isholdcollateral` | `varchar` | `null` |
| `isholdfunds` | `varchar` | `"Y"` |
| `isimposedpenalty` | `varchar` | `null` |
| `isinvestigation` | `varchar` | `null` |
| `isinvestmentadvisor` | `varchar` | `"N"` |
| `isinvestmentadvisoryact` | `varchar` | `"N\|Y\|N\|N\|Y\|Y\|Y\|Y\|Y\|N\|N"` |
| `isinvestmentrelated` | `varchar` | `null` |
| `ismadefalsestatement` | `varchar` | `null` |
| `ismathematicalmodels` | `varchar` | `"Y"` |
| `isnamedincivilproceeding` | `varchar` | `null` |
| `isnamedinregulatoryproceeding` | `varchar` | `null` |
| `isnonresidententity` | `varchar` | `"N"` |
| `isnotidentified` | `varchar` | `"N"` |
| `isonbehalf` | `varchar` | `"Y"` |
| `isorderagainst` | `varchar` | `null` |
| `isorderagainstactivity` | `varchar` | `null` |
| `ispersonregistered` | `varchar` | `null` |
| `isrecordskept` | `varchar` | `"N"` |
| `isregisteredasother` | `varchar` | `"N"` |
| `isregisteredwithcommission` | `varchar` | `"N"` |
| `issecurityact` | `varchar` | `"Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y\|Y"` |
| `isselfdetermine` | `varchar` | `"Y"` |
| `isshouldberemoved` | `varchar` | `null` |
| `issubjecttoregulator` | `varchar` | `"N"` |
| `issubmittedtocrd` | `varchar` | `null` |
| `issucceeding` | `varchar` | `"N"` |
| `isswapdealer` | `varchar` | `"Y"` |
| `isswapparticipant` | `varchar` | `"N"` |
| `isunethical` | `varchar` | `null` |
| `isusemathmodels` | `varchar` | `"N"` |
| `isviolatedregulation` | `varchar` | `null` |
| `iswhollyorpartiallyfinance` | `varchar` | `"N"` |
| `islitigation` | `varchar` | `null` |
| `lastname` | `varchar` | `"NAMIAS\|BRICKER\|OLIVIER\|BRUNEAU\|VIGNERON\|SANI\|KALLALA\|HAIZE\|MIGNON\|HALBERSTADT\|GARNIER\|LALOU\|OPPETIT\|LEBLANC\|PARISET\|PINAULT\|DE BEAUREPAIRE\|DE SAINT VICTOR\|DUBAND\|PROGLIO\|DE TAVERNOST\|HOURDAIN\|GARC...` |
| `legalstatus` | `varchar` | `"Limited Liability Company"` |
| `livetestflag` | `varchar` | `null` |
| `mailingaddresscity` | `varchar` | `"NEW YORK"` |
| `mailingaddressstateorcountry` | `varchar` | `"NY"` |
| `mailingaddressstreet1` | `varchar` | `"599 LEXINGTON AVENUE"` |
| `mailingaddressstreet2` | `varchar` | `null` |
| `mailingaddresszipcode` | `varchar` | `"10022"` |
| `mainaddresscity` | `varchar` | `null` |
| `mainaddressstateorcountry` | `varchar` | `null` |
| `mainaddressstreet1` | `varchar` | `null` |
| `mainaddressstreet2` | `varchar` | `null` |
| `mainaddresszipcode` | `varchar` | `null` |
| `matterresolvedtype` | `varchar` | `null` |
| `middlename` | `varchar` | `"RAYMOND\|YVAN MARIE\|JACQUES YVES\|FLORENCE\|ROGER MARIE\|MICHELE\|FRANCOISE GEORGETTE\|MARIE LOUIS REGIS MICHEL\|MARIE THERESE HELENE\|JEAN MICHAEL\|EDOUARD\|ABEL\|CLAIRE MARIE"` |
| `monetaryfineamount` | `varchar` | `null` |
| `monthapplicantfiscalends` | `varchar` | `"December"` |
| `name` | `varchar` | `"NATIXIS"` |
| `nameofapplicant` | `varchar` | `"J.P. MORGAN SECURITIES LLC"` |
| `nameofcountry` | `varchar` | `"I0\|I0\|2M"` |
| `nameofcourt` | `varchar` | `null` |
| `nameoffirm` | `varchar` | `"ATM Execution LLC\|Cowen and Company, LLC\|Westminster Research Associates LLC\|Cowen Prime Advisors LLC"` |
| `nameofpersonsigning` | `varchar` | `"Scott Stevens"` |
| `nameofprincipal` | `varchar` | `null` |
| `nameofregulatory` | `varchar` | `"Autorite des Marches Financiers (AMF)\|Autorite de Controle Prudentiel (ACPR)\|European Central Bank (ECB)"` |
| `nfaidentificationno` | `varchar` | `"509362\|518156\|452212\|503142\|531868\|531846\|535664\|539882\|453552\|452213\|542494\|485866\|253893\|532263\|502105\|519421\|526669\|461782\|530856\|453548\|466598\|532312\|494880"` |
| `numberofcounts` | `varchar` | `null` |
| `numberofprincipals` | `varchar` | `"24"` |
| `officernamefirstname` | `varchar` | `"Joseph"` |
| `officernamelastname` | `varchar` | `"Cerullo"` |
| `officernamemiddlename` | `varchar` | `null` |
| `officernameprefix` | `varchar` | `"Mr"` |
| `officernamesuffix` | `varchar` | `null` |
| `onbehalfdescriptionarrangement` | `varchar` | `null` |
| `onbehalfdetailsonbehalffirmaddresscity` | `varchar` | `"New York\|New York\|New York"` |
| `onbehalfdetailsonbehalffirmaddressstateorcountry` | `varchar` | `"NY\|NY\|NY"` |
| `onbehalfdetailsonbehalffirmaddressstreet1` | `varchar` | `"599 Lexington Ave\|599 Lexington Ave\|240 Greenwich Street 4th floor"` |
| `onbehalfdetailsonbehalffirmaddresszipcode` | `varchar` | `"10022\|10022\|10286"` |
| `onbehalffirmaddresscity` | `varchar` | `"New York NY\|Tel Aviv-Yafo\|New York\|New York"` |
| `onbehalffirmaddressstateorcountry` | `varchar` | `"NY\|L3\|NY\|NY"` |
| `onbehalffirmaddressstreet1` | `varchar` | `"731 Lexington Avenue\|Derech Menachem Begin 121\|225 Liberty Street\|ONE NORTH END AVENUE"` |
| `onbehalffirmaddressstreet2` | `varchar` | `null` |
| `onbehalffirmaddresszipcode` | `varchar` | `"10020\|4970103\|10281\|10282"` |
| `onbehalffirmciknumber` | `varchar` | `"0000048966"` |
| `onbehalffirmcrdno` | `varchar` | `"000007616\|000122529"` |
| `onbehalffirmeffectivedate` | `varchar` | `"03-29-2018\|03-29-2018\|11-15-2018"` |
| `onbehalffirmnfa` | `varchar` | `null` |
| `onbehalffirmorindividual` | `varchar` | `"Firm\|Firm\|Firm"` |
| `onbehalffirmororganizationname` | `varchar` | `"Cowen and Company, LLC\|ATM Execution LLC\|The Bank of New York Mellon"` |
| `onbehalffirmuic` | `varchar` | `"549300WR155U7DVMIW58\|54930031NZWF09VVYY54\|HPFHU0OQ28E4N0NFVK49"` |
| `onbehalfresponsetype` | `varchar` | `"Item 11B\|Item 11B\|Item 11B"` |
| `organizationname` | `varchar` | `null` |
| `othername` | `varchar` | `null` |
| `otherprincipalsanction` | `varchar` | `null` |
| `othersanctionsordered` | `varchar` | `null` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `ownershipcode` | `varchar` | `"NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA\|NA"` |
| `partneraddresscity` | `varchar` | `"London\|London\|Central Hong Kong\|New York\|New York\|Stamford\|New York\|New York\|New York\|New York\|New York"` |
| `partneraddressstateorcountry` | `varchar` | `"X0\|X0\|K3\|NY\|NY\|CT\|NY\|NY\|NY\|NY\|NY"` |
| `partneraddressstreet1` | `varchar` | `"1 Snowden St\|1 Snowden St.\|2 Wyndham St 22nd floor\|599 Lexington Ave\|599 Lexington Ave\|300 Atlantic Street\|599 Lexington Ave\|599 Lexington Ave.\|599 Lexington Ave\|599 Lexington Ave\|599 Lexington Ave"` |
| `partneraddressstreet2` | `varchar` | `"11th floor\|11th fl\|Suite 600"` |
| `partneraddresszipcode` | `varchar` | `"EC2ADQ\|EC2A2DQ\|LKF29\|10022\|10022\|06901\|10022\|10022\|10022\|10022\|10022"` |
| `partnercorporgname` | `varchar` | `"Cowen Execution Services Ltd.\|Cowen International Ltd.\|Cowen & Co (Asia) Ltd.\|Westminster Research Associates LLC\|Chi Advisors LLC\|Healthcare Royalty Management, LLC\|Ramius Advisors, LLC\|Cowen Inv...` |
| `partnercorporgtype` | `varchar` | `"under common control with applicant\|under common control with applicant\|under common control with applicant\|under common control with applicant\|under common control with applicant\|under common con...` |
| `partnercrdnumber` | `varchar` | `"000014508\|000304684\|000169355\|000110806\|000151953\|000315686\|000007616\|000122529"` |
| `partneruicnumber` | `varchar` | `"213800SS94VGJTFLIG64\|213800S7FGLGM4J4MV84\|213800WXXN4911F23T48\|54930026SYDE4SQNDN03\|549300VUPTX7X88D8E04\|VR4B1033DFSW6GD35B69\|YJZPNSPEVY2MX745S257\|549300X855XKPWLLMA70\|549300WR155U7DVMIW58\|5493003...` |
| `penaltyfineamount` | `varchar` | `null` |
| `personaddresscity` | `varchar` | `null` |
| `personaddressstateorcountry` | `varchar` | `null` |
| `personaddressstreet1` | `varchar` | `null` |
| `personaddresszipcode` | `varchar` | `null` |
| `persontelephonenumber` | `varchar` | `null` |
| `persontype` | `varchar` | `null` |
| `phone` | `varchar` | `"614-217-1577"` |
| `plea` | `varchar` | `null` |
| `prefix` | `varchar` | ``"`"`` |
| `principalinfoapplicantname` | `varchar` | `null` |
| `principalname` | `varchar` | `null` |
| `principalproducttype` | `varchar` | `null` |
| `principalproducttypeotherdesc` | `varchar` | `null` |
| `principalsanction` | `varchar` | `null` |
| `prudentialregulator` | `varchar` | `"The Federal Reserve Board"` |
| `prudentialregulatorsprudentialregulator` | `varchar` | `"The Federal Reserve Board\|The Office of the Comptroller of the Currency\|The Federal Deposit Insurance Corporation\|The Farm Credit Administration\|The Federal Housing Finance Agency"` |
| `reasontowithdraw` | `varchar` | `null` |
| `recordskeptdescriptionarrangement` | `varchar` | `null` |
| `recordskeptdetailsrecordskeptdescriptionarrangement` | `varchar` | `null` |
| `recordskeptdetailsrecordskeptfirmaddresscity` | `varchar` | `"Sunnydale"` |
| `recordskeptdetailsrecordskeptfirmaddressstateorcountry` | `varchar` | `"CA"` |
| `recordskeptdetailsrecordskeptfirmaddressstreet1` | `varchar` | `"829 Ross Dr."` |
| `recordskeptdetailsrecordskeptfirmaddressstreet2` | `varchar` | `null` |
| `recordskeptdetailsrecordskeptfirmaddresszipcode` | `varchar` | `"94089"` |
| `recordskeptdetailsrecordskeptfirmciknumber` | `varchar` | `null` |
| `recordskeptdetailsrecordskeptfirmeffectivedate` | `varchar` | `"03-29-2018"` |
| `recordskeptdetailsrecordskeptfirmororganizationname` | `varchar` | `"Proofpoint"` |
| `recordskeptdetailsrecordskeptresponsetype` | `varchar` | `"Item 11A"` |
| `recordskeptfirmaddresscity` | `varchar` | `"Boston\|Moorisville\|Holtsville\|Boston"` |
| `recordskeptfirmaddressstateorcountry` | `varchar` | `"MA\|NC\|NY\|MA"` |
| `recordskeptfirmaddressstreet1` | `varchar` | `"1 Federal Street\|2100 Gateway Centre Blvd\|5000 Corporate Court\|55 Thomson Place"` |
| `recordskeptfirmaddressstreet2` | `varchar` | `"Suite 200\|Suite 203"` |
| `recordskeptfirmaddresszipcode` | `varchar` | `"02110-2012\|27560-6228\|11742-2010\|02210-1244"` |
| `recordskeptfirmciknumber` | `varchar` | `null` |
| `recordskeptfirmeffectivedate` | `varchar` | `"10-30-2009\|08-23-2019\|09-15-2021\|08-16-2010"` |
| `recordskeptfirmorindividual` | `varchar` | `"Firm"` |
| `recordskeptfirmororganizationname` | `varchar` | `"Iron Mountain Information Management, LLC\|RegEd\|Cisive\|DTCC ITP, LLC (formerly Omgeo, LLC)"` |
| `recordskeptfirmuic` | `varchar` | `null` |
| `recordskeptresponsetype` | `varchar` | `"Item 13A\|Item 13A\|Item 13A\|Item 13A"` |
| `registeredas` | `varchar` | `"Swap Dealer"` |
| `registrationtype` | `varchar` | `null` |
| `regulatorname` | `varchar` | `null` |
| `regulatoryactiondisclosureisauthorizedtoactattorney` | `varchar` | `"N"` |
| `regulatoryactiondisclosureiscauseofdenial` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisdeniedlicense` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisdisciplined` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisfoundincauseofdenial` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisfoundincauseofsuspension` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisfoundinviolationofregulation` | `varchar` | `"Y"` |
| `regulatoryactiondisclosureisfoundinviolationofrules` | `varchar` | `"Y"` |
| `regulatoryactiondisclosureisfoundmadefalsestatement` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisimposedpenalty` | `varchar` | `"Y"` |
| `regulatoryactiondisclosureismadefalsestatement` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisnamedinregulatoryproceeding` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisorderagainst` | `varchar` | `"Y"` |
| `regulatoryactiondisclosureisorderagainstactivity` | `varchar` | `"Y"` |
| `regulatoryactiondisclosureisunethical` | `varchar` | `"N"` |
| `regulatoryactiondisclosureisviolatedregulation` | `varchar` | `"Y"` |
| `regulatoryactioninitiatedby` | `varchar` | `null` |
| `regulatorydrpdetailsdocketorcasenumber` | `varchar` | `null` |
| `regulatorydrpdrpfiledfor` | `varchar` | `"One or more control affiliate(s)"` |
| `regulatorydrpinitialoramended` | `varchar` | `"INITIAL"` |
| `resolutiondatedate` | `varchar` | `null` |
| `resolutiondateexactorexplanation` | `varchar` | `null` |
| `respondingtoresponsequestion` | `varchar` | `"14D(2)\|14C(4)\|14C(5)\|14D(4)\|14E(2)\|14C(2)"` |
| `responsequestion` | `varchar` | `null` |
| `responsetype` | `varchar` | `"Item 13B\|Item 13B\|Item 13B\|Item 13B"` |
| `returncopyflag` | `varchar` | `"true"` |
| `sanctiondetail` | `varchar` | `null` |
| `sanctionordered` | `varchar` | `null` |
| `scheduleainfocrdno` | `varchar` | `"002133254\|001281617\|002561401\|001645834"` |
| `scheduleainfodescription` | `varchar` | `"2011, appointed Chairman of the Management Board of Caisse d'Epargne de Picardie. 2016, member of the BPCE Management Board, Chief Executive Officer, Retail Banking and Insurance. 2018, Chairman o...` |
| `scheduleainfofirmorindividual` | `varchar` | `"Firm\|Individual\|Individual\|Individual\|Individual\|Individual\|Individual\|Individual"` |
| `schedulebapplicantname` | `varchar` | `"NATIXIS"` |
| `schedulebapplicantnfano` | `varchar` | `"309904"` |
| `scheduledlistapplicantname` | `varchar` | `null` |
| `scheduledlistapplicantnfano` | `varchar` | `null` |
| `scheduledlistciviljudicialactiondisclosureisfoundinviolationofregulation` | `varchar` | `null` |
| `scheduledoneapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `scheduledoneinitialoramended` | `varchar` | `"INITIAL"` |
| `scheduledthreeapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `scheduledthreeinitialoramended` | `varchar` | `"INITIAL"` |
| `scheduledtwoapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `scheduledtwoinitialoramended` | `varchar` | `"INITIAL"` |
| `scheduleeapplicantname` | `varchar` | `"Cowen Financial Products LLC"` |
| `schedulefapplicantname` | `varchar` | `null` |
| `schedulefapplicantnfano` | `varchar` | `"309904"` |
| `schedulefsignature` | `varchar` | `"NICOLAS NAMIAS"` |
| `secfilenumber` | `varchar` | `null` |
| `sectionfiveeffectivedate` | `varchar` | `"03-29-2018\|03-29-2018\|03-29-2018\|03-29-2018\|03-29-2018\|03-29-2018\|03-29-2018\|03-29-2018\|07-31-2021\|03-29-2018\|03-29-2018"` |
| `sectionfourdescription` | `varchar` | `null` |
| `sectionsixcountryofdomicile` | `varchar` | `null` |
| `sectionsixdescriptionrelationship` | `varchar` | `null` |
| `sectionsixeffectivedate` | `varchar` | `null` |
| `sectionsixuicnumber` | `varchar` | `null` |
| `sentencepenalty` | `varchar` | `null` |
| `serviceaddresscity` | `varchar` | `"NEW YORK"` |
| `serviceaddressstateorcountry` | `varchar` | `"NY"` |
| `serviceaddressstreet1` | `varchar` | `"NATIXIS"` |
| `serviceaddresszipcode` | `varchar` | `"10020"` |
| `serviceofprocessfirmname` | `varchar` | `null` |
| `serviceofprocessfirmorindividual` | `varchar` | `"Individual"` |
| `signature` | `varchar` | `"Joseph Cerullo"` |
| `signaturedate` | `varchar` | `"10-20-2021"` |
| `signername` | `varchar` | `"NICOLAS NAMIAS"` |
| `signertitle` | `varchar` | `"CHIEF EXECUTIVE OFFICER"` |
| `startdatepenalty` | `varchar` | `null` |
| `stateofformation` | `varchar` | `"DE"` |
| `stateorcountry` | `varchar` | `null` |
| `street1` | `varchar` | `null` |
| `street2` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"SBSE-BD"` |
| `suffix` | `varchar` | `"Jr"` |
| `summaryofcircumstances` | `varchar` | `null` |
| `summaryofdetails` | `varchar` | `null` |
| `swapoption` | `varchar` | `"maintains a substantial security-based swap position\|has substantial counterparty exposure\|is highly leveraged to its capital position"` |
| `taxidentificationno` | `varchar` | `"00-0000000"` |
| `taxidentificationnumber` | `varchar` | `null` |
| `telephonenumber` | `varchar` | `null` |
| `terminationdate` | `varchar` | `null` |
| `title` | `varchar` | `"Chief Executive Officer"` |
| `titleofpersonsigning` | `varchar` | `"Compliance Manager"` |
| `titleorstatus` | `varchar` | `"CHIEF EXECUTIVE OFFICER\|CHIEF FINANCIAL OFFICER\|General Secretary\|CHIEF COMPLIANCE OFFICER\|CHIEF RISK OFFICER\|CHIEF OPERATING OFFICER\|CO-HEAD OF CIB\|GLOBAL HEAD OF GLOBAL MARKETS\|DIRECTOR, CHAIRMA...` |
| `typeofentity` | `varchar` | `null` |
| `uicnumber` | `varchar` | `"KX1WK48MPD4Y2NCUIZ63"` |
| `websiteurl` | `varchar` | `null` |
| `whollyorpartiallyfinancedescriptionarrangement` | `varchar` | `null` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancedescriptionarrangement` | `varchar` | `null` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmaddresscity` | `varchar` | `"New York"` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmaddressstateorcountry` | `varchar` | `"NY"` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmaddressstreet1` | `varchar` | `"599 Lexington Ave."` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmaddressstreet2` | `varchar` | `null` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmaddresszipcode` | `varchar` | `"10022"` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmciknumber` | `varchar` | `"0001466538"` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmcrdno` | `varchar` | `null` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmeffectivedate` | `varchar` | `"03-29-2018"` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmororganizationname` | `varchar` | `"Cowen Inc."` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinancefirmuic` | `varchar` | `"5493008QI0EFC5WBED75"` |
| `whollyorpartiallyfinancedetailswhollyorpartiallyfinanceresponsetype` | `varchar` | `"Item 12B"` |
| `whollyorpartiallyfinancefirmaddresscity` | `varchar` | `"San Francisco\|New York"` |
| `whollyorpartiallyfinancefirmaddressstateorcountry` | `varchar` | `"CA\|NY"` |
| `whollyorpartiallyfinancefirmaddressstreet1` | `varchar` | `"420 Montgomery Street\|500 W. 33rd Street"` |
| `whollyorpartiallyfinancefirmaddressstreet2` | `varchar` | `"30 Hudson Yards Floor 14"` |
| `whollyorpartiallyfinancefirmaddresszipcode` | `varchar` | `"94104-1207\|10001-1301"` |
| `whollyorpartiallyfinancefirmciknumber` | `varchar` | `"0000072971\|0001738143"` |
| `whollyorpartiallyfinancefirmcrdno` | `varchar` | `null` |
| `whollyorpartiallyfinancefirmeffectivedate` | `varchar` | `"06-28-2017\|07-17-2018"` |
| `whollyorpartiallyfinancefirmforeignbusinessno` | `varchar` | `null` |
| `whollyorpartiallyfinancefirmnfa` | `varchar` | `null` |
| `whollyorpartiallyfinancefirmorindividual` | `varchar` | `"Firm"` |
| `whollyorpartiallyfinancefirmororganizationname` | `varchar` | `"Wells Fargo & Company\|Wells Fargo Finance, LLC"` |
| `whollyorpartiallyfinancefirmsecfilenumber` | `varchar` | `null` |
| `whollyorpartiallyfinancefirmuic` | `varchar` | `"LEI - PBLD0EJDB5FWOLXP3B7\|LEI-549300B4EK2P19158U08"` |
| `whollyorpartiallyfinanceresponsetype` | `varchar` | `"Item 15\|Item 15"` |
| `zipcode` | `varchar` | `null` |

### sbse_schedule_b_info

document_types: `SBSE`, `SBSE-A`, `SBSE-A/A`, `SBSE-BD`, `SBSE-BD/A`, `SBSE-C`, `SBSE-W`, `SBSE/A`, `SBSEF`, `SBSEF-W`, `SBSEF/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `177101521000006` |
| `filingdate` | `varchar` | `"2021-10-27"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2021-10-27/sbse_schedule_b_info/000177101521000006.parquet"` |
| `_table` | `varchar` | `"sbse_schedule_b_info"` |
| `foreignbusinessno` | `varchar` | `null` |
| `interestownedentity` | `varchar` | `"RCG LV Pearl, LLC"` |
| `pr` | `varchar` | `"PR"` |
| `schedulebinfocontrolperson` | `varchar` | `"Y"` |
| `schedulebinfodatetitleorstatusacquired` | `varchar` | `"03/2018"` |
| `schedulebinfoentitytype` | `varchar` | `"DE"` |
| `schedulebinfofirmorindividual` | `varchar` | `"Firm"` |
| `schedulebinfofulllegalname` | `varchar` | `"Cowen Inc."` |
| `schedulebinfoirstaxno` | `varchar` | `"27-0423711"` |
| `schedulebinfoownershipcode` | `varchar` | `"E"` |
| `status` | `varchar` | `"Managing Member"` |
| `uic` | `varchar` | `"5493008QI0EFC5WBED75"` |

### schedule_13d

document_types: `SCHEDULE 13D`, `SCHEDULE 13D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `89271224000022` |
| `filingdate` | `varchar` | `"2024-02-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-02-02/schedule_13d/000089271224000022.parquet"` |
| `_table` | `varchar` | `"schedule_13d"` |
| `amendmentno` | `varchar` | `"7"` |
| `authorizedcity` | `varchar` | `"Milwaukee"` |
| `authorizedpersonname` | `varchar` | `"Dennis F. Connolly"` |
| `authorizedpersonphone` | `varchar` | `"414-273-3500"` |
| `authorizedstateorcountry` | `varchar` | `"WI"` |
| `authorizedstreet1` | `varchar` | `"Godfrey & Kahn, S.C."` |
| `authorizedstreet2` | `varchar` | `"833 East Michigan Street, Suite 1800"` |
| `authorizedzipcode` | `varchar` | `"53202"` |
| `dateofevent` | `varchar` | `"01/31/2024"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001701081"` |
| `issuercik` | `varchar` | `"0001692063"` |
| `issuercusip` | `varchar` | `"80689H102"` |
| `issuercity` | `varchar` | `"GREEN BAY"` |
| `issuername` | `varchar` | `"Schneider National, Inc."` |
| `issuerstateorcountry` | `varchar` | `"WI"` |
| `issuerstreet1` | `varchar` | `"3101 SOUTH PACKERLAND DRIVE"` |
| `issuerstreet2` | `varchar` | `"ONE VANDERBILT AVENUE"` |
| `issuerzipcode` | `varchar` | `"54313"` |
| `item1city` | `varchar` | `"GREEN BAY"` |
| `item1commenttext` | `varchar` | `"Cover Page Notes:\n\nTherese A. Koller:\n\nThe shares reported in Item 7 consist of shares of Class B Common Stock. Includes 1,191,870 shares of Class B Common Stock held in trust for the benefit ...` |
| `item1issuername` | `varchar` | `"Schneider National, Inc."` |
| `item1securitytitle` | `varchar` | `"Class B Common Stock, no par value per share"` |
| `item1stateorcountry` | `varchar` | `"WI"` |
| `item1street1` | `varchar` | `"3101 SOUTH PACKERLAND DRIVE"` |
| `item1street2` | `varchar` | `"ONE VANDERBILT AVENUE"` |
| `item1zipcode` | `varchar` | `"54313"` |
| `item2citizenship` | `varchar` | `"Nilesh Undavia is a citizen of the United States; Liliana Undavia is a citizen of the United States and Portugal; and Kanta Undavia is a citizen of India."` |
| `item2convictiondescription` | `varchar` | `"During the last 5 years, none of the Reporting Persons has been party to a civil proceeding of a judicial or administrative body of competent jurisdiction as a result of which such person or entit...` |
| `item2filingpersonname` | `varchar` | `"This statement is being filed by (i) The Nilesh P Undavia 2018 Trust u/a Dated 10/25/2018 (the NPU Trust); (ii) The Liliana Arsenio-Undavia 2018 Trust u/a Dated 10/25/2018 (the LAU Trust); (iii) T...` |
| `item2hasbeenconvicted` | `varchar` | `"During the last 5 years, none of the Reporting Persons has been convicted in a criminal proceeding (excluding traffic violations or similar misdemeanors)."` |
| `item2principalbusinessaddress` | `varchar` | `"The business addresses of each the Reporting Persons is 155 E Boca Raton Road, Unit 416, Boca Raton, Florida 33432."` |
| `item2principaljob` | `varchar` | `"The principal business of each of the Reporting Persons that is a trust is to administer the assets of the trust for the benefit of the beneficiaries thereof. Nilesh Undavia, Liliana Undavia, and ...` |
| `item3fundssource` | `varchar` | `"Item 3 of the Original Schedule 13D is supplemented with the following:\n\nBetween February 7, 2023 and January 31, 2024, Ms. Koller acquired 6,619 shares of Class B Common Stock in settlement of ...` |
| `item4transactionpurpose` | `varchar` | `"The filers of this 13D include Nilesh Undavia (\"Mr. Undavia\").   Mr. Undavia has more than 25 years of investing experience.   Mr. Undavia has a particular expertise investing in cyclical compan...` |
| `item5date5percentownership` | `varchar` | `"Not applicable"` |
| `item5listofshareholders` | `varchar` | `"Not applicable"` |
| `item5numberofshares` | `varchar` | `"Nilesh Undavia is the record holder of 8,692,926 Shares through two individual retirement accounts (the \"IRAs\"). Nilesh Undavia is the sole trustee of the LU Irrev Trust. Accordingly, Nilesh Und...` |
| `item5percentageofclass` | `varchar` | `"As of the date of this filing, the Reporting Persons beneficially own 14,738,251 shares (the \"Shares\"), or approximately 5.74%, of the outstanding Common Stock of the Issuer (calculated based on...` |
| `item5transactiondesc` | `varchar` | `"The following table sets forth all transactions with respect to Shares effected during the past sixty (60) days by any of the Reporting Persons. Except as otherwise noted below, all such transacti...` |
| `item6contractdescription` | `varchar` | `"Item 6 of the Original Schedule 13D is supplemented with the following:\n\nSchneider Family Board Nomination Process Agreement\n\n\tOn February 14, 2023, the Nomination Agreement was amended and r...` |
| `item7filedexhibits` | `varchar` | `"Item 7 of the Original Schedule 13D is supplemented with the following:\n\nExhibit\n\nA\tAmended and Restated Schneider Family Board Nomination Process Agreement (incorporated by reference to Exhi...` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `previousaccessionnumber` | `varchar` | `"0000892712-17-000358"` |
| `previouslyfiledflag` | `varchar` | `"false"` |
| `securitiesclasstitle` | `varchar` | `"Class B Common Stock, no par value per share"` |
| `signaturecommenttext` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"SCHEDULE 13D/A"` |

### schedule_13d_reporting_person

document_types: `SCHEDULE 13D`, `SCHEDULE 13D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `89271224000022` |
| `filingdate` | `varchar` | `"2024-02-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-02-02/schedule_13d_reporting_person/000089271224000022.parquet"` |
| `_table` | `varchar` | `"schedule_13d_reporting_person"` |
| `aggregateamountowned` | `varchar` | `"21529452.00"` |
| `citizenshipororganization` | `varchar` | `"WI"` |
| `commentcontent` | `varchar` | `"Trust"` |
| `fundtype` | `varchar` | `"OO"` |
| `isaggregateexcludeshares` | `varchar` | `"N"` |
| `legalproceedings` | `varchar` | `"N"` |
| `memberofgroup` | `varchar` | `null` |
| `percentofclass` | `varchar` | `"19.6"` |
| `reportingpersoncik` | `varchar` | `"0001701081"` |
| `reportingpersonname` | `varchar` | `"Koller Therese A."` |
| `reportingpersonnocik` | `varchar` | `"N"` |
| `shareddispositivepower` | `varchar` | `"18631589.00"` |
| `sharedvotingpower` | `varchar` | `"18631589.00"` |
| `soledispositivepower` | `varchar` | `"2897863.00"` |
| `solevotingpower` | `varchar` | `"2897863.00"` |
| `typeofreportingperson` | `varchar` | `"IN"` |

### schedule_13d_signature_person

document_types: `SCHEDULE 13D`, `SCHEDULE 13D/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `89271224000022` |
| `filingdate` | `varchar` | `"2024-02-02"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2024-02-02/schedule_13d_signature_person/000089271224000022.parquet"` |
| `_table` | `varchar` | `"schedule_13d_signature_person"` |
| `date` | `varchar` | `"01/31/2024"` |
| `signature` | `varchar` | `"/s/ Therese A. Koller"` |
| `signaturereportingperson` | `varchar` | `"Koller Therese A."` |
| `title` | `varchar` | `"Therese A. Koller"` |

### schedule_13g

document_types: `SCHEDULE 13G`, `SCHEDULE 13G/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `199881323000002` |
| `filingdate` | `varchar` | `"2023-12-18"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2023-12-18/schedule_13g/000199881323000002.parquet"` |
| `_table` | `varchar` | `"schedule_13g"` |
| `amendmentno` | `varchar` | `"1"` |
| `designaterulepursuantthisschedulefiled` | `varchar` | `"Rule 13d-1(c)"` |
| `eventdaterequiresfilingthisstatement` | `varchar` | `"12/05/2023"` |
| `exhibitinfo` | `varchar` | `"1) PDF version of Schedule 13G\n2) Power of Attorney of David P. Cohen"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001998813"` |
| `issuercik` | `varchar` | `"0001892500"` |
| `issuercity` | `varchar` | `"VANCOUVER, BRITISH COLUMBIA"` |
| `issuercusip` | `varchar` | `"1850532047"` |
| `issuername` | `varchar` | `"Clearmind Medicine Inc."` |
| `issuerstateorcountry` | `varchar` | `"Z4"` |
| `issuerstreet1` | `varchar` | `"101-1220 WEST 6TH AVENUE"` |
| `issuerstreet2` | `varchar` | `"101-1220 WEST 6TH AVENUE"` |
| `issuerzipcode` | `varchar` | `"V6H1A5"` |
| `item10certifications` | `varchar` | `"By signing below I certify that, to the best of my knowledge and belief, the securities referred to above were not acquired and are not held for the purpose of or with the effect of changing or in...` |
| `item10notapplicable` | `varchar` | `"N"` |
| `item1issueraddress` | `varchar` | `"101-1220 WEST 6TH AVENUE, 101-1220 WEST 6TH AVENUE, VANCOUVER, BRITISH COLUMBIA, , V6H1A5."` |
| `item1issuername` | `varchar` | `"Clearmind Medicine Inc."` |
| `item2citizenship` | `varchar` | `"Israel"` |
| `item2filingpersonname` | `varchar` | `"Eli Polatov"` |
| `item2principaladdress` | `varchar` | `"48 Rothschild St., Bat Yam, Israel"` |
| `item3notapplicable` | `varchar` | `"Y"` |
| `item3othertypeofpersonfiling` | `varchar` | `"CAYMAN ISLANDS REGULATED FUND"` |
| `item3typeofpersonfiling` | `varchar` | `"EP"` |
| `item4amountbeneficiallyowned` | `varchar` | `"0"` |
| `item4classpercent` | `varchar` | `"0"` |
| `item4shareddispositivepower` | `varchar` | `"0"` |
| `item4sharedvotingpower` | `varchar` | `"0"` |
| `item4soledispositivepower` | `varchar` | `"0"` |
| `item4solevotingpower` | `varchar` | `"0"` |
| `item5classownership5percentorless` | `varchar` | `"Y"` |
| `item5notapplicable` | `varchar` | `"N"` |
| `item6notapplicable` | `varchar` | `"Y"` |
| `item6ownershipmorethan5percent` | `varchar` | `null` |
| `item7notapplicable` | `varchar` | `"N"` |
| `item7subsidiaryidentification` | `varchar` | `"Armon Real Estate Agency Ltd., an Israeli company wholly-owned\nby Eli Polatov"` |
| `item8groupmembers` | `varchar` | `null` |
| `item8notapplicable` | `varchar` | `"Y"` |
| `item9groupdissolutionnotice` | `varchar` | `null` |
| `item9notapplicable` | `varchar` | `"Y"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `previousaccessionnumber` | `varchar` | `"0001998813-23-000001"` |
| `securitiesclasstitle` | `varchar` | `"Common Shares"` |
| `signaturecomments` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"SCHEDULE 13G/A"` |

### schedule_13g_reporting_person

document_types: `SCHEDULE 13G`, `SCHEDULE 13G/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `199881323000002` |
| `filingdate` | `varchar` | `"2023-12-18"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2023-12-18/schedule_13g_reporting_person/000199881323000002.parquet"` |
| `_table` | `varchar` | `"schedule_13g_reporting_person"` |
| `aggregateamountexcludescertainsharesflag` | `varchar` | `null` |
| `aggregatesharesowned` | `varchar` | `"0.00"` |
| `citizenshipororganization` | `varchar` | `"L3"` |
| `classpercent` | `varchar` | `"0.0"` |
| `comments` | `varchar` | `null` |
| `membergroup` | `varchar` | `"b"` |
| `reportingpersonname` | `varchar` | `"Polatov Eli"` |
| `shareddispositivepower` | `varchar` | `"0.00"` |
| `sharedvotingpower` | `varchar` | `"0.00"` |
| `soledispositivepower` | `varchar` | `"0.00"` |
| `solevotingpower` | `varchar` | `"0.00"` |
| `typeofreportingperson` | `varchar` | `"IN"` |

### schedule_13g_signature_information

document_types: `SCHEDULE 13G`, `SCHEDULE 13G/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `199881323000002` |
| `filingdate` | `varchar` | `"2023-12-18"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2023-12-18/schedule_13g_signature_information/000199881323000002.parquet"` |
| `_table` | `varchar` | `"schedule_13g_signature_information"` |
| `signature` | `varchar` | `"Eli Polatov"` |
| `signaturedate` | `varchar` | `"12/18/2023"` |
| `signaturereportingpersonname` | `varchar` | `"Polatov Eli"` |
| `signaturetitle` | `varchar` | `"Individual"` |

### sdr

document_types: `SDR`, `SDR/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `165849616000008` |
| `filingdate` | `varchar` | `"2016-04-18"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-04-18/sdr/000165849616000008.parquet"` |
| `_table` | `varchar` | `"sdr"` |
| `amendeditemslist` | `varchar` | `"Exhibits: A; A1; C; D; D2; D4; D5; D6; E; E2; F; H; I2; I3; J1; K; L1; L2; M; N; N1; O; O1; P; Q1; Q2; R; S1; U4; U5; V; X; Y; Z; Z1; AA; AA1; DD; FF; FF1; GG; GG1; GG2; GG3; GG4; GG6; GG7; HH; HH...` |
| `applicanttype` | `varchar` | `"Other Form of Organization"` |
| `applicanttypeconfflag` | `varchar` | `"false"` |
| `applicanttypeotherdesc` | `varchar` | `"Limited Liability Company"` |
| `assetclassesconfflag` | `varchar` | `"false"` |
| `assetclasseslist` | `varchar` | `"ICE Trade Vault will accept data in respect of all security-based swap trades in the credit derivatives asset class."` |
| `businessaddressconfflag` | `varchar` | `"false"` |
| `businesscity` | `varchar` | `"ATLANTA"` |
| `businessnameconfflag` | `varchar` | `"false"` |
| `businessstateorcountry` | `varchar` | `"GA"` |
| `businessstreet1` | `varchar` | `"5660 NEW NORTHSIDE DRIVE NW"` |
| `businesszipcode` | `varchar` | `"30328"` |
| `confirmingcopyflag` | `varchar` | `"false"` |
| `consentaddressconfflag` | `varchar` | `"false"` |
| `consentapplicantname` | `varchar` | `"ICE Trade Vault, LLC"` |
| `consentcity` | `varchar` | `"Atlanta"` |
| `consentnameconfflag` | `varchar` | `"false"` |
| `consentpersonname` | `varchar` | `"Kara Dutta, General Counsel, ICE Trade Vault, LLC"` |
| `consentphone` | `varchar` | `"770-916-7812"` |
| `consentphoneconfflag` | `varchar` | `"false"` |
| `consentstateorcountry` | `varchar` | `"GA"` |
| `consentstreet1` | `varchar` | `"5660 New Northside Drive NW, Third Floor"` |
| `consentzipcode` | `varchar` | `"30328"` |
| `contactemail` | `varchar` | `"takako.okada@theice.com"` |
| `contactname` | `varchar` | `"Takako Okada"` |
| `contactphone` | `varchar` | `"678-589-1828"` |
| `corporgconfflag` | `varchar` | `"false"` |
| `dateofincorporation` | `varchar` | `"03-28-2011"` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001658496"` |
| `functiondescription` | `varchar` | `"ICE Trade Vault collects and maintains data and information related to swap transactions and makes such data and information directly and electronically available to regulators in accordance with ...` |
| `functiondescriptionconfflag` | `varchar` | `"false"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `officecity` | `varchar` | `"Atlanta"` |
| `officeconfflag` | `varchar` | `"false"` |
| `officename` | `varchar` | `"Atlanta"` |
| `officestateorcountry` | `varchar` | `"GA"` |
| `officestreet1` | `varchar` | `"5660 New Northside Drive NW, Third Floor"` |
| `officezipcode` | `varchar` | `"30328"` |
| `overrideinternetflag` | `varchar` | `"false"` |
| `partnershipconfflag` | `varchar` | `"false"` |
| `predecessorcikflag` | `varchar` | `"false"` |
| `predecessornameaddressflag` | `varchar` | `"false"` |
| `previousbusinessnameconfflag` | `varchar` | `"false"` |
| `principalapplicantname` | `varchar` | `"ICE Trade Vault, LLC"` |
| `principalcity` | `varchar` | `"ATLANTA"` |
| `principalconfflag` | `varchar` | `"false"` |
| `principalstateorcountry` | `varchar` | `"GA"` |
| `principalstreet1` | `varchar` | `"5660 NEW NORTHSIDE DRIVE NW"` |
| `principalzipcode` | `varchar` | `"30328"` |
| `returncopyflag` | `varchar` | `"false"` |
| `signature` | `varchar` | `"Bruce A. Tupper"` |
| `signatureapplicantname` | `varchar` | `"ICE Trade Vault, LLC"` |
| `signatureconfflag` | `varchar` | `"false"` |
| `signaturedate` | `varchar` | `"03-28-2016"` |
| `signaturetitle` | `varchar` | `"President"` |
| `stateofincorporation` | `varchar` | `"DE"` |
| `submissiontype` | `varchar` | `"SDR"` |
| `successiondateflag` | `varchar` | `"false"` |
| `successionflag` | `varchar` | `"true"` |
| `successorconfflag` | `varchar` | `"false"` |

### sh_er

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er"` |
| `cik` | `varchar` | `"0001217541"` |

### sh_er_friday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_friday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_friday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-26"` |
| `shortendposition` | `varchar` | `"356802"` |
| `shortstartposition` | `varchar` | `"356802"` |

### sh_er_monday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_monday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_monday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-22"` |
| `shortendposition` | `varchar` | `"356802"` |
| `shortstartposition` | `varchar` | `"373612"` |

### sh_er_saturday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_saturday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_saturday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-27"` |
| `shortendposition` | `varchar` | `"356802"` |
| `shortstartposition` | `varchar` | `"356802"` |

### sh_er_sunday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_sunday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_sunday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-21"` |
| `shortendposition` | `varchar` | `"373612"` |
| `shortstartposition` | `varchar` | `"373612"` |

### sh_er_thursday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_thursday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_thursday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-25"` |
| `shortendposition` | `varchar` | `"356802"` |
| `shortstartposition` | `varchar` | `"356802"` |

### sh_er_tuesday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_tuesday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_tuesday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-23"` |
| `shortendposition` | `varchar` | `"356802"` |
| `shortstartposition` | `varchar` | `"356802"` |

### sh_er_wednesday

document_types: `SH-ER`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `95015208010804` |
| `filingdate` | `varchar` | `"2008-12-29"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2008-12-29/sh_er_wednesday/000095015208010804.parquet"` |
| `_table` | `varchar` | `"sh_er_wednesday"` |
| `cusip` | `varchar` | `"037604105"` |
| `nameofissuer` | `varchar` | `"Apollo Group"` |
| `numbersecuritiessoldshort` | `varchar` | `null` |
| `saledate` | `varchar` | `"2008-12-24"` |
| `shortendposition` | `varchar` | `"356802"` |
| `shortstartposition` | `varchar` | `"356802"` |

### ta_1

document_types: `TA-1`, `TA-1/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `112483806000005` |
| `filingdate` | `varchar` | `"2006-12-18"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2006-12-18/ta_1/000112483806000005.parquet"` |
| `_table` | `varchar` | `"ta_1"` |
| `authoritydescription` | `varchar` | `"INVESCO breached its fiduciary duty by failing to disclose conflicts of interest raised by allowing market timing and by failing to inform fund directors. INVESCO neither admitted nor denied the a...` |
| `authorizationdeniedorsuspendedinvolved` | `varchar` | `null` |
| `ccc` | `varchar` | `null` |
| `cik` | `varchar` | `"0001124838"` |
| `city` | `varchar` | `"Las Vegas"` |
| `conductbusinessinotherlocations` | `varchar` | `"false"` |
| `controlperson` | `varchar` | `"true\|false\|false"` |
| `corporationpartnershipdatacontrolperson` | `varchar` | `null` |
| `corporationpartnershipdataentityname` | `varchar` | `"Cadmus Kilgore Lawson\|John Parriott Chilton\|Candace Leah Bossay"` |
| `corporationpartnershipdataownershipcode` | `varchar` | `null` |
| `corporationpartnershipdatarelationshipstartdate` | `varchar` | `"2007-01-29"` |
| `corporationpartnershipdatatitleorstatus` | `varchar` | `null` |
| `differentmailingaddress` | `varchar` | `"false"` |
| `disciplinaryhistoryenjoinedinvestmentrelatedactivityinvolved` | `varchar` | `null` |
| `disciplinaryhistoryfalsestatementoromissioninvolved` | `varchar` | `null` |
| `disciplinaryhistoryfelonyormisdemeanorinvolved` | `varchar` | `null` |
| `disciplinaryhistoryforeignagencyinvolved` | `varchar` | `null` |
| `disciplinaryhistoryotherfelonyinvolved` | `varchar` | `null` |
| `disciplinaryhistoryregistrationdeniedorsuspendedinvolved` | `varchar` | `null` |
| `disciplinaryhistoryrevokedbondinvolved` | `varchar` | `null` |
| `disciplinaryhistorysubjectofproceedingsinvolved` | `varchar` | `null` |
| `disciplinaryhistoryunsatisfiedjudgementsorliensinvolved` | `varchar` | `null` |
| `disciplinaryhistoryviolationofinvestmentrelatedregulationinvolved` | `varchar` | `null` |
| `disciplinaryhistoryviolationofregulationsinvolved` | `varchar` | `null` |
| `engagedasservicecompany` | `varchar` | `"false"` |
| `engagedservicecompany` | `varchar` | `"false"` |
| `enjoinedinvestmentrelatedactivityinvolved` | `varchar` | `"false"` |
| `entityname` | `varchar` | `"1st Global Stock transfer, LLC"` |
| `falsestatementoromissioninvolved` | `varchar` | `"false"` |
| `federalorstateregulatoryagencyfsrauthorizationdeniedorsuspendedinvolved` | `varchar` | `null` |
| `federalorstateregulatoryagencyfsrfalsestatementoromissioninvolved` | `varchar` | `null` |
| `federalorstateregulatoryagencyfsrfoundorderagainstapplicantinvolved` | `varchar` | `null` |
| `federalorstateregulatoryagencyfsrregistrationdeniedorsuspendedinvolved` | `varchar` | `null` |
| `federalorstateregulatoryagencyfsrrevokedsuspendedlicenseinvolved` | `varchar` | `null` |
| `federalorstateregulatoryagencyfsrviolationofinvestmentrelatedregulationinvolved` | `varchar` | `null` |
| `felonyormisdemeanorinvolved` | `varchar` | `"false"` |
| `filercredentialscik` | `varchar` | `null` |
| `finsnumber` | `varchar` | `"084-05870\|088930"` |
| `foreignagencyinvolved` | `varchar` | `"false"` |
| `formversion` | `varchar` | `"1.0.0"` |
| `fsrauthorizationdeniedorsuspendedinvolved` | `varchar` | `"false"` |
| `fsrfalsestatementoromissioninvolved` | `varchar` | `"false"` |
| `fsrfoundorderagainstapplicantinvolved` | `varchar` | `"false"` |
| `fsrregistrationdeniedorsuspendedinvolved` | `varchar` | `"false"` |
| `fsrrevokedsuspendedlicenseinvolved` | `varchar` | `"false"` |
| `fsrviolationofinvestmentrelatedregulationinvolved` | `varchar` | `"false"` |
| `headerdatasubmissiontype` | `varchar` | `null` |
| `independentregistrantcorporationpartnershipdataentityname` | `varchar` | `"INVESCO Funds Group, Inc. (?INVESCO?)\|INVESCO Funds Group, Inc. (?INVESCO?)\|INVESCO Funds Group, Inc. (?INVESCO?)\|INVESCO Funds Group, Inc. (?INVESCO?)\|A I M Advisors, Inc. (?AA?)\|A I M Advisors, ...` |
| `independentregistrantothercontrolmanagementotherentity` | `varchar` | `null` |
| `independentregistrantregistranttype` | `varchar` | `null` |
| `involved` | `varchar` | `"false"` |
| `livetestflag` | `varchar` | `null` |
| `othercontrolfinanceotherentity` | `varchar` | `null` |
| `othercontrolmanagementotherentity` | `varchar` | `"false"` |
| `otherentity` | `varchar` | `"false"` |
| `otherfelonyinvolved` | `varchar` | `"false"` |
| `ownershipcode` | `varchar` | `"E\|C\|NA"` |
| `principalofficeaddresscity` | `varchar` | `null` |
| `principalofficeaddressstateorcountry` | `varchar` | `null` |
| `principalofficeaddressstreet1` | `varchar` | `null` |
| `principalofficeaddressstreet2` | `varchar` | `null` |
| `principalofficeaddresszipcode` | `varchar` | `null` |
| `registrantconductbusinessinotherlocations` | `varchar` | `"United States Securities and Exchange Commission (?SEC?)\|United States Securities and Exchange Commission (?SEC?)\|United States Securities and Exchange Commission (?SEC?)\|United States Securities ...` |
| `registrantdifferentmailingaddress` | `varchar` | `null` |
| `registrantengagedasservicecompany` | `varchar` | `null` |
| `registrantengagedservicecompany` | `varchar` | `null` |
| `registrantentityname` | `varchar` | `null` |
| `registrantfinsnumber` | `varchar` | `null` |
| `registrantregulatoryagency` | `varchar` | `null` |
| `registrantselftransferagent` | `varchar` | `null` |
| `registranttelephonenumber` | `varchar` | `null` |
| `registranttype` | `varchar` | `"Not Applicable"` |
| `registranttypedescription` | `varchar` | `"Bridges Investment Counsel, Inc.; 256 Durham Plaza; 8401 West Dodge Road; Omaha, Nebraska 68114, entered into an Agreement dated July 30, 1987, with Bridges Investor Services, Inc. (BIS) to provid...` |
| `registrationdeniedorsuspendedinvolved` | `varchar` | `"false"` |
| `regulatoryagency` | `varchar` | `"SEC"` |
| `relationshipstartdate` | `varchar` | `"1971-09-01\|1981-10-01\|1999-02-08\|1973-12-01"` |
| `returncopyflag` | `varchar` | `null` |
| `revokedbondinvolved` | `varchar` | `"false"` |
| `schemaversion` | `varchar` | `"X0101"` |
| `selfregulatoryagencysraauthorizationdeniedorsuspendedinvolved` | `varchar` | `null` |
| `selfregulatoryagencysrafalsestatementoromissioninvolved` | `varchar` | `null` |
| `selfregulatoryagencysrarevokedsuspendedlicenseinvolved` | `varchar` | `null` |
| `selfregulatoryagencysraviolationofrulesinvolved` | `varchar` | `null` |
| `selftransferagent` | `varchar` | `"false"` |
| `signaturedate` | `varchar` | `"2006-12-18"` |
| `signaturename` | `varchar` | `"Helen Bagley"` |
| `signaturephonenumber` | `varchar` | `"702-656-4919"` |
| `signaturesignaturedate` | `varchar` | `null` |
| `signaturesignaturename` | `varchar` | `null` |
| `signaturesignaturephonenumber` | `varchar` | `null` |
| `signaturesignaturetitle` | `varchar` | `null` |
| `signaturetitle` | `varchar` | `"President"` |
| `soleproprietorshipotherdataentityname` | `varchar` | `"INVESCO Funds Group, Inc.\|INVESCO Funds Group, Inc.\|INVESCO Funds Group, Inc.\|INVESCO Funds Group, Inc.\|A I M Advisors, Inc.\|A I M Advisors, Inc."` |
| `soleproprietorshipotherdatarelationshipstartdate` | `varchar` | `null` |
| `soleproprietorshipotherdatatitleorstatus` | `varchar` | `null` |
| `sraauthorizationdeniedorsuspendedinvolved` | `varchar` | `"false"` |
| `srafalsestatementoromissioninvolved` | `varchar` | `"false"` |
| `srarevokedsuspendedlicenseinvolved` | `varchar` | `"false"` |
| `sraviolationofrulesinvolved` | `varchar` | `"false"` |
| `stateorcountry` | `varchar` | `"NEVADA"` |
| `stateorcountrycode` | `varchar` | `"NV"` |
| `street1` | `varchar` | `"7361 Prairie Falcon Road, Suite 110"` |
| `street2` | `varchar` | `"Suite 1300"` |
| `subjectofproceedingsinvolved` | `varchar` | `"false"` |
| `submissiontype` | `varchar` | `"TA-1/A"` |
| `telephonenumber` | `varchar` | `"702-656-4919"` |
| `testorlive` | `varchar` | `"LIVE"` |
| `titleorstatus` | `varchar` | `"Pres/Tr/Dir\|Director\|Vice Pres/Secty"` |
| `unsatisfiedjudgementsorliensinvolved` | `varchar` | `"false"` |
| `violationofinvestmentrelatedregulationinvolved` | `varchar` | `"false"` |
| `violationofregulationsinvolved` | `varchar` | `"false"` |
| `zipcode` | `varchar` | `"89147"` |

### ta_1_as_service_company

document_types: `TA-1`, `TA-1/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `90956707000075` |
| `filingdate` | `varchar` | `"2007-01-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-01-22/ta_1_as_service_company/000090956707000075.parquet"` |
| `_table` | `varchar` | `"ta_1_as_service_company"` |
| `corporationpartnershipdataentityname` | `varchar` | `"AIM Investment Services, Inc."` |
| `principalofficeaddresscity` | `varchar` | `"Houston"` |
| `principalofficeaddressstateorcountry` | `varchar` | `"TEXAS"` |
| `principalofficeaddressstreet1` | `varchar` | `"11 Greenway Plaza"` |
| `principalofficeaddressstreet2` | `varchar` | `"Ste 100"` |
| `principalofficeaddresszipcode` | `varchar` | `"77046"` |
| `registrantfinsnumber` | `varchar` | `"084-05432"` |
| `stateorcountrycode` | `varchar` | `"TX"` |

### ta_1_other_business_location

document_types: `TA-1`, `TA-1/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `138779307000004` |
| `filingdate` | `varchar` | `"2007-02-07"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-02-07/ta_1_other_business_location/000138779307000004.parquet"` |
| `_table` | `varchar` | `"ta_1_other_business_location"` |
| `city` | `varchar` | `"Washington"` |
| `principalofficeaddresscity` | `varchar` | `null` |
| `principalofficeaddressstateorcountry` | `varchar` | `null` |
| `principalofficeaddressstreet1` | `varchar` | `null` |
| `principalofficeaddressstreet2` | `varchar` | `null` |
| `principalofficeaddresszipcode` | `varchar` | `null` |
| `stateorcountry` | `varchar` | `"DISTRICT OF COLUMBIA"` |
| `stateorcountrycode` | `varchar` | `"DC"` |
| `street1` | `varchar` | `"900 17th Street, NW"` |
| `street2` | `varchar` | `"8th Floor"` |
| `zipcode` | `varchar` | `"20006"` |

### ta_1_service_company

document_types: `TA-1`, `TA-1/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `79502907000006` |
| `filingdate` | `varchar` | `"2007-02-08"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-02-08/ta_1_service_company/000079502907000006.parquet"` |
| `_table` | `varchar` | `"ta_1_service_company"` |
| `corporationpartnershipdataentityname` | `varchar` | `"Synovus Trust Company, NA"` |
| `principalofficeaddresscity` | `varchar` | `"Columbus"` |
| `principalofficeaddressstateorcountry` | `varchar` | `"GEORGIA"` |
| `principalofficeaddressstreet1` | `varchar` | `"1148 Broadway"` |
| `principalofficeaddressstreet2` | `varchar` | `null` |
| `principalofficeaddresszipcode` | `varchar` | `"31901"` |
| `registrantfinsnumber` | `varchar` | `"085-11388"` |
| `stateorcountrycode` | `varchar` | `"GA"` |

### ta_2

document_types: `TA-2`, `TA-2/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `102174207000004` |
| `filingdate` | `varchar` | `"2007-02-06"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-02-06/ta_2/000102174207000004.parquet"` |
| `_table` | `varchar` | `"ta_2"` |
| `additionalinformation` | `varchar` | `null` |
| `alwayscompliant` | `varchar` | `null` |
| `amendmentfiled` | `varchar` | `"NA"` |
| `amountissues` | `varchar` | `"0"` |
| `asservicecompanytransferagententityname` | `varchar` | `null` |
| `asservicecompanytransferagentfilenumber` | `varchar` | `null` |
| `ccc` | `varchar` | `null` |
| `cik` | `varchar` | `"0001021742"` |
| `currentagentamountissues` | `varchar` | `null` |
| `currentagentnumberissues` | `varchar` | `null` |
| `databasesearchdate` | `varchar` | `"2006-03-14"` |
| `databasesearchesdatabasesearchdate` | `varchar` | `null` |
| `databasesearchesnumberaddressesfromsearch` | `varchar` | `null` |
| `databasesearchesnumberlostaccountssearched` | `varchar` | `null` |
| `debtsecurity` | `varchar` | `"0"` |
| `directregistrationsystem` | `varchar` | `null` |
| `directregistrationsystemnumberissues` | `varchar` | `"1"` |
| `dividendandinterestamountissues` | `varchar` | `"272506912"` |
| `dividendandinterestnumberissues` | `varchar` | `"1"` |
| `dividendreinvdirectpurchaseplan` | `varchar` | `null` |
| `dividendreinvdirectpurchaseplannumberissues` | `varchar` | `"1"` |
| `engagedservicecompanyasservicecompanytransferagententityname` | `varchar` | `null` |
| `engagedservicecompanyasservicecompanytransferagentfilenumber` | `varchar` | `null` |
| `engagedservicecompanyfunction` | `varchar` | `"NONE"` |
| `engagedservicecompanyservicecompanytransferagententityname` | `varchar` | `null` |
| `engagedservicecompanyservicecompanytransferagentfilenumber` | `varchar` | `null` |
| `entityname` | `varchar` | `"The Peoples Bank"` |
| `equitysecurity` | `varchar` | `"41"` |
| `filenumber` | `varchar` | `"085-00799"` |
| `filercredentialscik` | `varchar` | `null` |
| `filerfilenumber` | `varchar` | `null` |
| `filerinfoentityname` | `varchar` | `null` |
| `filerinfoperiodofreport` | `varchar` | `null` |
| `filerinfotestorlive` | `varchar` | `null` |
| `formversion` | `varchar` | `"1.1.0"` |
| `function` | `varchar` | `"false"` |
| `headerdatasubmissiontype` | `varchar` | `null` |
| `isfilingamendment` | `varchar` | `null` |
| `limitedpartnership` | `varchar` | `"0"` |
| `municipaldebt` | `varchar` | `"59"` |
| `nottransmaintmastersecholderdebtsecurity` | `varchar` | `"0"` |
| `nottransmaintmastersecholderequitysecurity` | `varchar` | `"0"` |
| `nottransmaintmastersecholderlimitedpartnership` | `varchar` | `"0"` |
| `nottransmaintmastersecholdermunicipaldebt` | `varchar` | `"0"` |
| `nottransmaintmastersecholderopenendinvestmentcompany` | `varchar` | `"0"` |
| `nottransmaintmastersecholderother` | `varchar` | `"0"` |
| `numberaddressesfromsearch` | `varchar` | `"1"` |
| `numberdirectregistsystemaccounts` | `varchar` | `"0"` |
| `numberdivreinvdirpurplanaccounts` | `varchar` | `"491"` |
| `numberfiled` | `varchar` | `null` |
| `numberindividualaccounts` | `varchar` | `"4490"` |
| `numberissues` | `varchar` | `"0"` |
| `numberitemsreceivedfortransfer` | `varchar` | `"302"` |
| `numberlostaccountsremittedtostates` | `varchar` | `"0"` |
| `numberlostaccountssearched` | `varchar` | `"1"` |
| `numbermastersecurityholderfilings` | `varchar` | `"0"` |
| `openendinvestmentcompany` | `varchar` | `"0"` |
| `other` | `varchar` | `"0"` |
| `periodofreport` | `varchar` | `"2006-12-31"` |
| `prioragentamountissues` | `varchar` | `"0"` |
| `prioragentnumberissues` | `varchar` | `"0"` |
| `purchaseredemptionpricingsharestotal` | `varchar` | `"0"` |
| `purchaseredemptionpricingsharestotalotherthanreceiptorderdate` | `varchar` | `"0"` |
| `quarterlyreportsregardingbuyinsnumberfiled` | `varchar` | `"0"` |
| `registrantengagedservice` | `varchar` | `null` |
| `registrantregulatoryagencyadditionalinformation` | `varchar` | `null` |
| `registrantregulatoryagencyamendmentfiled` | `varchar` | `null` |
| `registrantregulatoryagencyregulatoryagency` | `varchar` | `null` |
| `regulatoryagency` | `varchar` | `"FDIC"` |
| `returncopy` | `varchar` | `null` |
| `schemaversion` | `varchar` | `"X0202"` |
| `securityholderaccountsdebtsecurity` | `varchar` | `null` |
| `securityholderaccountsequitysecurity` | `varchar` | `null` |
| `securityholderaccountslimitedpartnership` | `varchar` | `null` |
| `securityholderaccountsmunicipaldebt` | `varchar` | `null` |
| `securityholderaccountsopenendinvestmentcompany` | `varchar` | `null` |
| `securityholderaccountsother` | `varchar` | `null` |
| `securityholderdatadividendandinterestamountissues` | `varchar` | `null` |
| `securityholderdatadividendandinterestnumberissues` | `varchar` | `null` |
| `securityholderdatanottransmaintmastersecholderdebtsecurity` | `varchar` | `null` |
| `securityholderdatanottransmaintmastersecholderequitysecurity` | `varchar` | `null` |
| `securityholderdatanottransmaintmastersecholderlimitedpartnership` | `varchar` | `null` |
| `securityholderdatanottransmaintmastersecholdermunicipaldebt` | `varchar` | `null` |
| `securityholderdatanottransmaintmastersecholderopenendinvestmentcompany` | `varchar` | `null` |
| `securityholderdatanottransmaintmastersecholderother` | `varchar` | `null` |
| `securityholderdataprioragentamountissues` | `varchar` | `null` |
| `securityholderdataprioragentnumberissues` | `varchar` | `null` |
| `securityholderdatatransmaintainmastersecholderdebtsecurity` | `varchar` | `null` |
| `securityholderdatatransmaintainmastersecholderequitysecurity` | `varchar` | `null` |
| `securityholderdatatransmaintainmastersecholderlimitedpartnership` | `varchar` | `null` |
| `securityholderdatatransmaintainmastersecholdermunicipaldebt` | `varchar` | `null` |
| `securityholderdatatransmaintainmastersecholderopenendinvestmentcompany` | `varchar` | `null` |
| `securityholderdatatransmaintainmastersecholderother` | `varchar` | `null` |
| `securityholderdatatransnotmaintmastersecholderdebtsecurity` | `varchar` | `null` |
| `securityholderdatatransnotmaintmastersecholderequitysecurity` | `varchar` | `null` |
| `securityholderdatatransnotmaintmastersecholderlimitedpartnership` | `varchar` | `null` |
| `securityholderdatatransnotmaintmastersecholdermunicipaldebt` | `varchar` | `null` |
| `securityholderdatatransnotmaintmastersecholderopenendinvestmentcompany` | `varchar` | `null` |
| `securityholderdatatransnotmaintmastersecholderother` | `varchar` | `null` |
| `servicecompany` | `varchar` | `null` |
| `servicecompanydatanumberdirectregistsystemaccounts` | `varchar` | `null` |
| `servicecompanydatanumberdivreinvdirpurplanaccounts` | `varchar` | `null` |
| `servicecompanydatanumberindividualaccounts` | `varchar` | `null` |
| `servicecompanydatanumberitemsreceivedfortransfer` | `varchar` | `null` |
| `servicecompanydatanumberlostaccountsremittedtostates` | `varchar` | `null` |
| `servicecompanydatanumbermastersecurityholderfilings` | `varchar` | `null` |
| `servicecompanytransferagententityname` | `varchar` | `"Synovus Trust Company, NA"` |
| `servicecompanytransferagentfilenumber` | `varchar` | `"085-11388"` |
| `signaturedatasignaturedate` | `varchar` | `null` |
| `signaturedatasignaturename` | `varchar` | `null` |
| `signaturedatasignaturephonenumber` | `varchar` | `null` |
| `signaturedatasignaturetitle` | `varchar` | `null` |
| `signaturedate` | `varchar` | `"2007-02-06"` |
| `signaturename` | `varchar` | `"Thomas H. Wicks"` |
| `signaturephonenumber` | `varchar` | `"228-435-8208"` |
| `signaturetitle` | `varchar` | `"Assistant Vice President/Trust Officer"` |
| `submissiontype` | `varchar` | `"TA-2"` |
| `testorlive` | `varchar` | `"LIVE"` |
| `total` | `varchar` | `null` |
| `totalotherthanreceiptorderdate` | `varchar` | `null` |
| `transmaintainmastersecholderdebtsecurity` | `varchar` | `"0"` |
| `transmaintainmastersecholderequitysecurity` | `varchar` | `"1"` |
| `transmaintainmastersecholderlimitedpartnership` | `varchar` | `"0"` |
| `transmaintainmastersecholdermunicipaldebt` | `varchar` | `"0"` |
| `transmaintainmastersecholderopenendinvestmentcompany` | `varchar` | `"0"` |
| `transmaintainmastersecholderother` | `varchar` | `"0"` |
| `transnotmaintmastersecholderdebtsecurity` | `varchar` | `"0"` |
| `transnotmaintmastersecholderequitysecurity` | `varchar` | `"0"` |
| `transnotmaintmastersecholderlimitedpartnership` | `varchar` | `"0"` |
| `transnotmaintmastersecholdermunicipaldebt` | `varchar` | `"0"` |
| `transnotmaintmastersecholderopenendinvestmentcompany` | `varchar` | `"0"` |
| `transnotmaintmastersecholderother` | `varchar` | `"0"` |
| `turnaroundcompliantalwayscompliant` | `varchar` | `"YES"` |

### ta_w

document_types: `TA-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `75304307000003` |
| `filingdate` | `varchar` | `"2007-02-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-02-22/ta_w/000075304307000003.parquet"` |
| `_table` | `varchar` | `"ta_w"` |
| `businessaddresscity` | `varchar` | `null` |
| `businessaddressstateorcountry` | `varchar` | `null` |
| `businessaddressstreet1` | `varchar` | `null` |
| `businessaddressstreet2` | `varchar` | `null` |
| `businessaddresszipcode` | `varchar` | `null` |
| `ccc` | `varchar` | `null` |
| `cik` | `varchar` | `"0000753043"` |
| `city` | `varchar` | `"Golden"` |
| `documentretentiontawcustodiansentityname` | `varchar` | `null` |
| `entityname` | `varchar` | `"Computershare Trust Company, Inc."` |
| `filenumber` | `varchar` | `"084-00969"` |
| `filercredentialscik` | `varchar` | `null` |
| `formversion` | `varchar` | `"1.0.0"` |
| `futuretransferagentfunctions` | `varchar` | `"false"` |
| `headerdatasubmissiontype` | `varchar` | `null` |
| `involved` | `varchar` | `null` |
| `lastactiondate` | `varchar` | `"2006-12-31"` |
| `livetestflag` | `varchar` | `null` |
| `registrantentityname` | `varchar` | `null` |
| `registrantfilenumber` | `varchar` | `null` |
| `returncopyflag` | `varchar` | `null` |
| `schemaversion` | `varchar` | `"X0101"` |
| `signaturedatasignaturedate` | `varchar` | `null` |
| `signaturedatasignaturename` | `varchar` | `null` |
| `signaturedatasignaturephonenumber` | `varchar` | `null` |
| `signaturedatasignaturetitle` | `varchar` | `null` |
| `signaturedate` | `varchar` | `"2007-02-22"` |
| `signaturename` | `varchar` | `"Howard McCarty"` |
| `signaturephonenumber` | `varchar` | `"312-588-4993, x 4778"` |
| `signaturetitle` | `varchar` | `"Senior Compliance Officer"` |
| `stateorcountry` | `varchar` | `"COLORADO"` |
| `stateorcountrycode` | `varchar` | `"CO"` |
| `street1` | `varchar` | `"350 Indiana Street"` |
| `street2` | `varchar` | `"Suite 800"` |
| `subjectofproceedingsinvolved` | `varchar` | `"false"` |
| `submissiontype` | `varchar` | `"TA-W"` |
| `successorregistered` | `varchar` | `"true"` |
| `successortransferagents` | `varchar` | `null` |
| `tawsuccessoraddresscity` | `varchar` | `"Canton"` |
| `tawsuccessoraddressstateorcountry` | `varchar` | `"MASSACHUSETTS"` |
| `tawsuccessoraddressstateorcountrycode` | `varchar` | `"MA"` |
| `tawsuccessoraddressstreet1` | `varchar` | `"250 Royalle Street"` |
| `tawsuccessoraddresszipcode` | `varchar` | `"02021"` |
| `tawsuccessordetailsentityname` | `varchar` | `"Computershare Trust Company, N.A."` |
| `tawsuccessorssuccessortransferagents` | `varchar` | `"true"` |
| `testorlive` | `varchar` | `"LIVE"` |
| `unsatisfiedjudgementsorliensinvolved` | `varchar` | `"false"` |
| `unsatisfiedjudgmentsinvolved` | `varchar` | `null` |
| `withdrawaldescription` | `varchar` | `"Merger with affiliate, Computershare Trust Company, N.A."` |
| `withdrawalfuturetransferagentfunctions` | `varchar` | `null` |
| `withdrawallastactiondate` | `varchar` | `null` |
| `withdrawalwithdrawaldescription` | `varchar` | `null` |
| `zipcode` | `varchar` | `"80401"` |

### ta_w_custodians

document_types: `TA-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `75304307000003` |
| `filingdate` | `varchar` | `"2007-02-22"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-02-22/ta_w_custodians/000075304307000003.parquet"` |
| `_table` | `varchar` | `"ta_w_custodians"` |
| `documentretentiontawcustodiansentityname` | `varchar` | `null` |
| `tawcustodianaddresscity` | `varchar` | `"Golden"` |
| `tawcustodianaddressstateorcountry` | `varchar` | `"COLORADO"` |
| `tawcustodianaddressstateorcountrycode` | `varchar` | `"CO"` |
| `tawcustodianaddressstreet1` | `varchar` | `"350 Indiana Street"` |
| `tawcustodianaddressstreet2` | `varchar` | `"Suite 800"` |
| `tawcustodianaddresszipcode` | `varchar` | `"80401"` |
| `tawcustodiansentityname` | `varchar` | `"Kellie Gwinn"` |
| `tawcustodianstawcustodianaddresscity` | `varchar` | `null` |
| `tawcustodianstawcustodianaddressstateorcountry` | `varchar` | `null` |
| `tawcustodianstawcustodianaddressstreet1` | `varchar` | `null` |
| `tawcustodianstawcustodianaddresszipcode` | `varchar` | `null` |

### ta_w_locations

document_types: `TA-W`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `114420407009682` |
| `filingdate` | `varchar` | `"2007-02-23"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2007-02-23/ta_w_locations/000114420407009682.parquet"` |
| `_table` | `varchar` | `"ta_w_locations"` |
| `documentretentiontawcustodiansentityname` | `varchar` | `null` |
| `tawcustodianaddresscity` | `varchar` | `"Malvern"` |
| `tawcustodianaddressstateorcountry` | `varchar` | `"PENNSYLVANIA"` |
| `tawcustodianaddressstateorcountrycode` | `varchar` | `"PA"` |
| `tawcustodianaddressstreet1` | `varchar` | `"83 General Warren Blvd."` |
| `tawcustodianaddressstreet2` | `varchar` | `"Suite 200"` |
| `tawcustodianaddresszipcode` | `varchar` | `"19355"` |
| `tawcustodiansentityname` | `varchar` | `"Citco Fund Services of America, Inc."` |
| `tawcustodianstawcustodianaddresscity` | `varchar` | `null` |
| `tawcustodianstawcustodianaddressstateorcountry` | `varchar` | `null` |
| `tawcustodianstawcustodianaddressstreet1` | `varchar` | `null` |
| `tawcustodianstawcustodianaddresszipcode` | `varchar` | `null` |

### x_17a_5

document_types: `X-17A-5`, `X-17A-5/A`

| Column | dtype | Sample value |
|---|---|---|
| `accessionnumber` | `bigint` | `141923716000007` |
| `filingdate` | `varchar` | `"2016-01-28"` |
| `_sourcekey` | `varchar` | `"sec-filings/xml2tables/2016-01-28/x_17a_5/000141923716000007.parquet"` |
| `_table` | `varchar` | `"x_17a_5"` |
| `accountantcity` | `varchar` | `"London E14 5GL"` |
| `accountantname` | `varchar` | `"KPMG Audit Plc"` |
| `accountantstateorcountry` | `varchar` | `"NY"` |
| `accountantstreet1` | `varchar` | `"15 Canada Square"` |
| `accountantstreet2` | `varchar` | `"Suite 200"` |
| `accountanttype` | `varchar` | `"Certified Public Accountant"` |
| `accountantzipcode` | `varchar` | `"10036"` |
| `amendmentdescription` | `varchar` | `null` |
| `brokerdealername` | `varchar` | `"FAP USA, L.P."` |
| `city` | `varchar` | `"NEW YORK"` |
| `confirmnotarizedflag` | `varchar` | `"Y"` |
| `contactpersonname` | `varchar` | `"Dmitriy Rutitskiy"` |
| `contactpersonphonenumber` | `varchar` | `"212-751-4422"` |
| `explanation` | `varchar` | `null` |
| `filerccc` | `varchar` | `"XXXXXXXX"` |
| `filercik` | `varchar` | `"0001419237"` |
| `livetestflag` | `varchar` | `"LIVE"` |
| `materialweakness` | `varchar` | `"N"` |
| `oathentityname` | `varchar` | `"FAP USA, L.P."` |
| `oathtitle` | `varchar` | `"Chief Executive Officer"` |
| `periodbegin` | `varchar` | `"12-01-2014"` |
| `periodend` | `varchar` | `"11-30-2015"` |
| `signdate` | `varchar` | `"11-30-2015"` |
| `signpersonname` | `varchar` | `"Paul Buckley"` |
| `signature` | `varchar` | `"Paul Buckley"` |
| `stateorcountry` | `varchar` | `"NY"` |
| `street1` | `varchar` | `"1114 AVENUE OF THE AMERICAS"` |
| `street2` | `varchar` | `"34TH FLOOR"` |
| `subtypeofbdregistrant` | `varchar` | `null` |
| `subtypeofregistrant` | `varchar` | `null` |
| `subtypeofsdregistrant` | `varchar` | `null` |
| `submissiontype` | `varchar` | `"X-17A-5"` |
| `typeofbdregistrant` | `varchar` | `null` |
| `typeofsdregistrant` | `varchar` | `null` |
| `zipcode` | `varchar` | `"10036"` |

