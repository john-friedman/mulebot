# SEC Filing Notifications

```tab-py
from datamulehub import sec_filings_notifications
```

```tab-js
import { sec_filings_notifications } from "datamulehub";
```

## Webhooks

You can add endpoints.

```tab-py
sec_filings_notifications.add_endpoint(endpoint="https://example.com/sec-filings", submission_types=None, ciks=None, sources=["Rss","Efts"])
```

```tab-js
await sec_filings_notifications.add_endpoint({
    endpoint: "https://example.com/sec-filings",
    sources: ["Rss", "Efts"],
});
```

- endpoint: your endpoint to recieve webhook notifications
- submission_types: e.g. 10-K, 8-K/A, etc.
- ciks: what companies, e.g. MSFT is 0000789019.
- sources: you should probably keep this at ["Rss","Efts"]. This is how the filing was detected.

You can list endpoints.

```tab-py
endpoints = sec_filings_notifications.list_endpoints()
```

```tab-js
const endpoints = await sec_filings_notifications.list_endpoints();
```

You can remove endpoints by url or id.

```tab-py
sec_filings_notifications.remove_endpoint(id=None,endpoint=None)
```

```tab-js
await sec_filings_notifications.remove_endpoint({ id: "webhook-id" });
// Or: await sec_filings_notifications.remove_endpoint({ endpoint: "https://example.com/sec-filings" });
```

- id: webhook id
- endpoint: webhook url

### Example

```tab-py
from datamulehub import sec_filings_notifications

sec_filings_notifications.add_endpoint(endpoint="https://example.com/sec-filings", submission_types=None, ciks=None, sources=["Rss","Efts"])
```

```tab-js
import { sec_filings_notifications } from "datamulehub";

await sec_filings_notifications.add_endpoint({
    endpoint: "https://example.com/sec-filings",
    sources: ["Rss", "Efts"],
});
```

## Websocket

You can receive notifications of new SEC filings via websocket.

```tab-py
sec_filings_notifications.stream_filings()
```

```tab-js
for await (const filing of sec_filings_notifications.stream_filings()) {
    console.log(filing);
}
```

### Example

```tab-py
from datamulehub import sec_filings_notifications

for filing in sec_filings_notifications.stream_filings():
    if filing["submission_type"] == "10-K":
        print("10-K:", filing)
```

```tab-js
import { sec_filings_notifications } from "datamulehub";

for await (const filing of sec_filings_notifications.stream_filings()) {
    if (filing.submission_type === "10-K") {
        console.log("10-K:", filing);
    }
}
```
