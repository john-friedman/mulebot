# Documentation

There are several ways to interface with Datamule's API.

1. datamulehub - newer package, currently being polished. [Python](https://github.com/john-friedman/datamule-hub), [TypeScript](https://github.com/john-friedman/datamulehub-ts).
2. datamule - old package. Deprecated, but often useful for new projects. [Python](https://github.com/john-friedman/datamule-python)

This documentation will only focus on datamulehub. Note that the [TypeScript] package is a LLM port.

## Installation

```tab-py
pip install datamule-hub
```

```tab-js
npm install datamulehub
```


## API Key

You can set `DATAMULE_API_KEY` to your environment, or pass `api_key` to function calls.

JavaScript uses the same function names, with keyword arguments passed in an options object.

## Logging

Python datamulehub hides logs by default. To enable:

```tab-py
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
```

JavaScript logs automatically through `console.info()`. No configuration is required.

## Important times

Datasets update both instantly and daily. The daily dataset takes up less space. Daily updates at 06:00 UTC Tuesday–Saturday. This is 1-2AM ET depending on Daylight Savings. We recommend if you want to refesh data at a daily interval, to pull after 09:00 UTC. Pulling after 06:15 UTC should be fine.

## Todo

- improve schemas

