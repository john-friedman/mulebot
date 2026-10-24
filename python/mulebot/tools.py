import json
import math
import os
import re
import sqlite3
import urllib.error
import urllib.request
from contextlib import closing

import sqlglot
from sqlglot import exp
from sqlglot.optimizer.annotate_types import annotate_types
from sqlglot.optimizer.scope import traverse_scope

from .assets import resource
from .tool import Tool, validate_arguments, validate_tools


SITE = "https://datamule.xyz"
API = "https://api.datamule.xyz/v3/athena/query/preview"
DOC_PAGES = {
    "docs": "docs.md",
    "datasets": "datasets.md",
    "schema": "schema.md",
    "products": "products.md",
    "sec-filings-lookup": "sec-filings-lookup.md",
    "sec-filings-archive": "sec_filings_archive.md",
    "sec-filings-notifications": "sec_filings_notifications.md",
    "transfer-to-your-cloud": "transfer_to_your_cloud.md",
    "utils": "utils.md",
}


class ApiError(RuntimeError):
    def __init__(self, message, metadata=None):
        super().__init__(message)
        self.metadata = metadata or {}


def fetch(url, payload=None, api_key=None):
    headers = {"User-Agent": "mulebot/0.1"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        url, headers=headers,
        data=json.dumps(payload).encode() if payload is not None else None,
    )
    try:
        with urllib.request.urlopen(request, timeout=150 if payload is not None else 30) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        metadata = {}
        try:
            error = json.loads(detail)
            detail = str(error.get("error", detail))
            if error.get("details"):
                detail += " " + json.dumps(error["details"], ensure_ascii=False)
            metadata = error.get("metadata", {})
        except (ValueError, AttributeError):
            pass
        raise ApiError(f"Datamule request failed ({exc.code}): {str(detail)[:2000]}", metadata) from None


def documentation_file(name):
    return resource("docs", name)


def documentation_context():
    return "\n\n".join(
        f"--- docs/{name} ---\n{documentation_file(name).read_text(encoding='utf-8')}"
        for name in DOC_PAGES.values()
    )


def _tool_definition(name, description, properties, required=()):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object", "properties": properties,
                "required": list(required), "additionalProperties": False,
            },
        },
    }


STRING = {"type": "string"}
TOOL_DEFINITIONS = [
    _tool_definition("query", "Fetch the user's complete requested dataset with one read-only Athena SELECT. "
         "Resolve identifiers in subqueries/CTEs within this SQL instead of separate lookup calls. "
         "Filter comparable records and deduplicate/aggregate before returning rows; do not fetch "
         "raw samples just to inspect them. Athena date differences use date_diff('day', start, end), "
         "not subtraction compared to an integer. Queries incur Datamule charges; LIMIT does not cap "
         "bytes scanned. If result_id is supplied, run a free local SQLite SELECT FROM data over "
         "that saved result instead. Use this for filtering, deduplication, aggregation, and reshaping "
         "data already fetched; never re-query Datamule for those operations.", {
             "sql": {"type": "string", "description": "Athena SQL for a new Datamule query, SQLite SQL for saved results. SQLite durations use julianday(end) - julianday(start), not CAST AS DATE or year subtraction."},
             "result_id": {"type": "string", "description": "Optional saved result to query locally using SQLite; omit only when fetching new data from Datamule."},
         }, ["sql"]),
    _tool_definition("write_markdown", "Create a text Markdown report for the caller to display or save. HTML and SVG are displayed as text, not rendered. Use plot for charts; fix a failed plot call instead of embedding SVG in Markdown.",
         {"title": STRING, "markdown": STRING}, ["title", "markdown"]),
    _tool_definition("plot", "Create one chart artifact from a required saved result_id returned by query. This tool never fetches new data. For separate charts, call plot separately with the same result_id and different local sql filters. Chart the final analysis rows used in your answer without querying Datamule again. y is a numeric column or a list of numeric columns for multiple lines; group is a categorical column, not another y. Optional sql filters or reshapes the saved rows using a read-only SQLite SELECT FROM data (SQLite dates use julianday; arrays/objects are JSON). Use this to reuse data on follow-ups. Line charts sort x ascending. Supply human-readable axis labels including units.", {
             "title": STRING, "result_id": {"type": "string", "description": "Required ID of a saved query result, such as query_5. Use its column names for x, y, and group. Fetch missing data with query first; never put a fresh Athena query into plot.sql."},
             "kind": {"type": "string", "enum": ["line", "bar", "scatter"]},
             "x": STRING, "y": {"anyOf": [STRING, {"type": "array", "items": STRING, "minItems": 1}]},
             "group": {"type": "string", "description": "Optional categorical series column. Omit for one series; do not repeat x or y."},
             "sql": {"type": "string", "description": "Optional read-only SQLite SELECT FROM data over result_id, for example SELECT * FROM data WHERE company = 'Oracle'. Omit to chart all saved rows. Athena tables, TRY_CAST, and CARDINALITY are not available here."},
             "x_label": STRING, "y_label": STRING,
         }, ["title", "result_id", "kind", "x", "y"]),
]


class Tools:
    def __init__(self, api_key=None, allowed_tables=None):
        self.api_key = api_key or os.environ.get("DATAMULE_API_KEY", "")
        if not isinstance(self.api_key, str) or not self.api_key.strip():
            raise ValueError("Pass api_key or set DATAMULE_API_KEY.")
        self.allowed_tables = None if allowed_tables is None else {t.lower() for t in allowed_tables}
        self.catalog = None
        self.results = {}
        self.artifacts = []
        self.registry = validate_tools([
            Tool(definition["function"]["name"], definition["function"]["description"],
                 definition["function"]["parameters"], getattr(self, definition["function"]["name"]))
            for definition in TOOL_DEFINITIONS
        ])

    def _saved_results_help(self):
        saved = [f"{result_id} ({len(result['rows'])} rows; columns: {', '.join(result['columns'])})"
                 for result_id, result in list(self.results.items())[-5:]]
        return ("Recent saved results: " + "; ".join(saved) + "." if saved else
                "No results are saved yet. Fetch data with query first.")

    def _saved_result(self, result_id):
        if not isinstance(result_id, str) or not result_id.strip() or result_id not in self.results:
            raise ValueError(f"Choose an existing saved result_id. {self._saved_results_help()}")
        return self.results[result_id]

    def _catalog(self):
        if self.catalog is None:
            entries = json.loads(fetch(f"{SITE}/static/jsons/athena_tables_catalog.json"))
            self.catalog = {
                entry["table"].lower(): entry for entry in entries
                if self.allowed_tables is None or entry["table"].lower() in self.allowed_tables
            }
        return self.catalog

    def _validated_sql(self, sql):
        statements = sqlglot.parse(sql, read="trino")
        if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.SetOperation)):
            raise ValueError("Only one SELECT query is allowed.")
        statement = statements[0]
        if any(isinstance(node, (exp.DDL, exp.DML, exp.Command, exp.Into, exp.Lock)) for node in statement.walk()):
            raise ValueError("Only read-only SELECT queries are allowed.")
        catalog = self._catalog()
        referenced = set()
        for scope in traverse_scope(statement):
            for source in scope.sources.values():
                if isinstance(source, exp.Table):
                    if not isinstance(source.this, exp.Identifier) or source.db or source.catalog:
                        raise ValueError("Use unqualified Datamule table names.")
                    name = source.name.lower()
                    if name not in catalog:
                        raise ValueError(f"Table is not available: {name}")
                    referenced.add(name)
        if not referenced:
            raise ValueError("Query must reference an available Datamule table.")
        return statement.sql(dialect="trino", comments=False)

    def query(self, sql, result_id=""):
        if result_id:
            result = self._saved_result(result_id)
            columns, rows = self._local_rows(result, sql)
            source_result_id = result_id
            result_id = f"view_{len(self.results) + 1}"
            self.results[result_id] = {"sql": sql, "columns": columns, "rows": rows,
                                       "source_result_id": source_result_id, "metadata": {}}
            return {"result_id": result_id, "source_result_id": source_result_id, "local": True,
                    "sql": sql, "columns": columns, "rows": rows, "row_count": len(rows), "metadata": {}}
        sql = self._validated_sql(sql)
        payload = json.loads(fetch(API, {"sql": sql, "wait_seconds": 120}, self.api_key))
        if not payload.get("success"):
            raise ApiError(payload.get("error", "Datamule query failed."), payload.get("metadata"))
        data = payload["data"]
        rows = [dict(zip(data["columns"], row)) for row in data["rows"]]
        local_types = self._result_types(sql, data["columns"])
        result_id = f"query_{len(self.results) + 1}"
        self.results[result_id] = {"sql": sql, "columns": data["columns"], "local_types": local_types,
                                   "rows": rows, "metadata": payload.get("metadata", {})}
        return {
            "result_id": result_id, "sql": sql, "columns": data["columns"],
            "rows": rows, "row_count": len(rows), "local_types": local_types,
            "metadata": payload.get("metadata", {}),
        }

    def write_markdown(self, title, markdown):
        if not isinstance(title, str) or not isinstance(markdown, str):
            raise ValueError("Title and Markdown must be strings.")
        prose = re.sub(r"^```[^\n]*\n[\s\S]*?^```[^\n]*$", "", markdown, flags=re.MULTILINE)
        if re.search(r"<svg\b", prose, flags=re.IGNORECASE):
            raise ValueError("Markdown artifacts cannot render SVG charts. Use plot with a saved result_id; "
                             "correct any failed plot call using its error message.")
        self.artifacts.append({"kind": "markdown", "title": title, "markdown": markdown})
        return {"artifact_id": len(self.artifacts), "title": title}

    def _result_types(self, sql, columns):
        schema = {}
        table = None
        for line in documentation_file("schema.md").read_text(encoding="utf-8").splitlines():
            if line.startswith("### "):
                table = line[4:].strip()
            elif table and line.startswith("| `"):
                column, dtype = line.split("|")[1:3]
                schema.setdefault(table, {})[column.strip(" `")] = dtype.strip(" `")
        try:
            selected = annotate_types(sqlglot.parse_one(sql, read="trino"), schema=schema, dialect="trino").selects
        except (sqlglot.errors.SqlglotError, ValueError, TypeError, KeyError):
            return {}
        if len(selected) != len(columns):
            return {}
        types = {}
        for column, expression in zip(columns, selected):
            dtype = expression.type
            if dtype and dtype.is_type("TINYINT", "SMALLINT", "INT", "BIGINT", "BOOLEAN"):
                types[column] = "INTEGER"
            elif dtype and dtype.is_type("FLOAT", "DOUBLE", "REAL"):
                types[column] = "REAL"
            elif dtype and dtype.is_type("DECIMAL"):
                types[column] = "NUMERIC"
            elif dtype and dtype.is_type("DATE"):
                types[column] = "DATE"
            elif dtype and not dtype.is_type("UNKNOWN"):
                types[column] = "TEXT"
        return types

    def _local_rows(self, result, sql):
        try:
            return self._select_rows(result, sql)
        except (ValueError, sqlite3.Error, sqlglot.errors.SqlglotError) as exc:
            columns = ", ".join(result["columns"])
            raise ValueError(f"Local SQLite query failed: {exc} Only the saved table data is available "
                             f"(columns: {columns}). Use SQLite syntax; Athena tables, TRY_CAST, and "
                             "CARDINALITY are not available here.") from exc

    def _select_rows(self, result, sql):
        statements = sqlglot.parse(sql, read="sqlite")
        if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.SetOperation)):
            raise ValueError("Local SQL must be one read-only SQLite SELECT FROM data.")
        statement = statements[0]
        if any(isinstance(node, (exp.DDL, exp.DML, exp.Command, exp.Into, exp.Lock)) for node in statement.walk()):
            raise ValueError("Local SQL must be read-only.")
        referenced = False
        for scope in traverse_scope(statement):
            for source in scope.sources.values():
                if isinstance(source, exp.Table):
                    if source.name.lower() != "data" or source.db or source.catalog:
                        raise ValueError("Local SQL can only read the saved table data.")
                    referenced = True
        if not referenced:
            raise ValueError("Local SQL must read the saved table data.")
        columns = result.get("columns") or list(result["rows"][0])
        quote = lambda value: '"' + value.replace('"', '""') + '"'

        def affinity(column):
            values = [row[column] for row in result["rows"] if row.get(column) is not None]
            if any(str(value).isascii() and str(value).lstrip("+-").isdigit()
                   and not -(2**63) <= int(value) < 2**63 for value in values):
                return "TEXT"
            dtype = result.get("local_types", {}).get(column)
            return ("TEXT" if dtype == "DATE" else dtype) or (
                "NUMERIC" if values and all(isinstance(value, (int, float)) for value in values) else "TEXT")

        def cell(value, column):
            if result.get("local_types", {}).get(column) == "DATE" and isinstance(value, str):
                return value[:10]
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False)
            if isinstance(value, int) and not -(2**63) <= value < 2**63:
                return str(value)
            return value

        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("CREATE TABLE data (" + ", ".join(quote(column) + " " + affinity(column) for column in columns) + ")")
            connection.executemany("INSERT INTO data VALUES (" + ",".join("?" for _ in columns) + ")",
                                   [tuple(cell(row.get(column), column) for column in columns) for row in result["rows"]])
            cursor = connection.execute(statement.sql(dialect="sqlite"))
            names = [column[0] for column in cursor.description]
            return names, [dict(zip(names, row)) for row in cursor.fetchall()]

    def plot(self, title, result_id, kind, x, y, group="", sql="", x_label="", y_label=""):
        if not isinstance(title, str):
            raise ValueError("Title must be a string.")
        if kind not in {"line", "bar", "scatter"}:
            raise ValueError("Choose line, bar, or scatter.")
        if group == x:
            group = ""
        result = self._saved_result(result_id)
        if not result["rows"]:
            raise ValueError(f"Saved result {result_id} is empty. Choose a non-empty result. "
                             f"{self._saved_results_help()}")
        columns, rows = self._local_rows(result, sql) if sql else (result.get("columns") or list(result["rows"][0]), result["rows"])
        if not rows:
            raise ValueError("The local chart selection returned no rows. Adjust the selection using the saved data.")
        series = [y] if isinstance(y, str) else y
        if not isinstance(series, list) or not series or not all(isinstance(column, str) for column in series):
            raise ValueError("y must be a column name or list of column names.")
        seen = {}
        numeric = False
        for row in rows:
            for column in [x, *series] + ([group] if group else []):
                if column not in row:
                    raise ValueError(f"Unknown chart column: {column}. Available columns: {', '.join(columns)}.")
            for column in series:
                if row[column] is None or row[x] is None:
                    continue
                if kind == "scatter" and not math.isfinite(float(row[x])):
                    raise ValueError("Scatter charts require finite numeric x values.")
                if not math.isfinite(float(row[column])):
                    raise ValueError("Chart values must be finite numbers or null.")
                numeric = True
                key = (str(row[x]), str(row.get(group)) if group else "", column)
                value = float(row[column])
                if key in seen and seen[key] != value and kind != "scatter":
                    raise ValueError("Multiple values share the same x and series. Use local sql to select comparable rows or add a categorical group.")
                seen[key] = value
        if not numeric:
            raise ValueError("The selected chart columns contain no numeric values.")
        if sql:
            source_result_id = result_id
            result_id = f"view_{len(self.results) + 1}"
            self.results[result_id] = {"sql": sql, "columns": columns, "rows": rows,
                                       "source_result_id": source_result_id, "metadata": {}}
        self.artifacts.append({
            "kind": kind, "title": title, "result_id": result_id, "x": x, "y": y, "group": group,
            "x_label": x_label, "y_label": y_label,
        })
        response = {"artifact_id": len(self.artifacts), "title": title, "result_id": result_id}
        if sql:
            response.update(columns=columns, rows=rows, row_count=len(rows))
        return response

    @property
    def definitions(self):
        return [entry.definition for entry in self.registry]

    def call(self, name, arguments):
        entry = next((entry for entry in self.registry if entry.name == name), None)
        if entry is None:
            raise ValueError(f"Unknown tool: {name}")
        if not isinstance(arguments, dict):
            raise ValueError("Tool arguments must be an object.")
        try:
            validate_arguments(arguments, entry.parameters, name)
        except ValueError as exc:
            if name == "plot" and "missing required field(s)" in str(exc):
                raise ValueError(f"{exc} Every plot requires a saved result_id. Optional sql is SQLite "
                                 f"SELECT FROM data, not a new Athena query. {self._saved_results_help()}") from None
            raise
        return entry.execute(**arguments)
