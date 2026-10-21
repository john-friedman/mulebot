# Utils

## format_accession

Convert an accession number between formats. Accepts any of the three as input.

```tab-py
format_accession(accession, format)
```

```tab-js
utils.format_accession(accession, format);
```

Formats:

- int : integer form, leading zeros dropped. e.g. `32019324000123`
- dash : 10-digit CIK, 2-digit year, 6-digit sequence, separated by dashes. e.g. `0000320193-24-000123`
- no-dash : 18 digits, no separators. e.g. `000032019324000123`

## Example

```tab-py
from datamulehub import utils

utils.format_accession("0000320193-24-000123", "int")      # 32019324000123
utils.format_accession("0000320193-24-000123", "no-dash")  # 000032019324000123
utils.format_accession(32019324000123, "dash")             # 0000320193-24-000123
```

```tab-js
import { utils } from "datamulehub";

utils.format_accession("0000320193-24-000123", "int");      // "32019324000123"
utils.format_accession("0000320193-24-000123", "no-dash");  // "000032019324000123"
utils.format_accession(32019324000123n, "dash");             // "0000320193-24-000123"
```

JavaScript returns strings for all formats. Use a string or `bigint` for accession numbers that exceed JavaScript's safe integer range.
