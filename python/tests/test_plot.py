import json
import unittest
from pathlib import Path
from unittest.mock import patch

from mulebot.agent import Agent, INSTRUCTIONS
from mulebot.tools import TOOL_DEFINITIONS, Tools


PLOT = {"title": "RPO", "kind": "line", "x": "filingdate", "y": "rpo_b"}
COMPANIES = ["Oracle", "Microsoft", "Alphabet"]


def saved_tools():
    tools = Tools("test-key")
    tools.results["query_5"] = {
        "sql": "SELECT company, filingdate, rpo_b FROM simple_xbrl",
        "columns": ["company", "filingdate", "rpo_b"],
        "rows": [{"company": company, "filingdate": date, "rpo_b": amount + index}
                 for index, company in enumerate(COMPANIES)
                 for date, amount in [("2025-06-01", 100), ("2025-09-01", 400)]],
        "local_types": {"company": "TEXT", "filingdate": "TEXT", "rpo_b": "REAL"},
        "metadata": {},
    }
    return tools


class PlotTests(unittest.TestCase):
    def setUp(self):
        network = patch("urllib.request.urlopen", side_effect=AssertionError("Unexpected network request"))
        network.start()
        self.addCleanup(network.stop)
        self.tools = saved_tools()

    def test_malformed_plot_has_actionable_error_and_preserves_state(self):
        with self.assertRaisesRegex(ValueError, r"missing required field\(s\): result_id") as caught:
            self.tools.call("plot", {**PLOT, "sql": "SELECT * FROM simple_xbrl"})
        self.assertIn("query_5", str(caught.exception))
        self.assertIn("filingdate, rpo_b", str(caught.exception))
        self.assertIn("SQLite SELECT FROM data", str(caught.exception))
        self.assertEqual(self.tools.artifacts, [])
        self.assertEqual(list(self.tools.results), ["query_5"])

    def test_separate_charts_reuse_saved_data(self):
        for index, company in enumerate(COMPANIES):
            result = self.tools.call("plot", {**PLOT, "title": company, "result_id": "query_5",
                "sql": f"SELECT * FROM data WHERE company = '{company}' ORDER BY filingdate"})
            self.assertEqual(result["artifact_id"], index + 1)
            self.assertEqual(result["row_count"], 2)
            saved = self.tools.results[result["result_id"]]
            self.assertEqual([row["company"] for row in saved["rows"]], [company, company])
            self.assertEqual(saved["source_result_id"], "query_5")
        self.assertEqual([artifact["title"] for artifact in self.tools.artifacts], COMPANIES)
        self.assertTrue(all(artifact["kind"] == "line" for artifact in self.tools.artifacts))
        self.assertEqual(len(self.tools.results["query_5"]["rows"]), 6)

    def test_sql_errors_can_be_corrected_without_fetching(self):
        for name in ["query", "plot"]:
            args = PLOT if name == "plot" else {}
            with self.assertRaisesRegex(ValueError, "Local SQLite query failed") as caught:
                self.tools.call(name, {**args, "result_id": "query_5", "sql": "SELECT * FROM simple_xbrl"})
            self.assertIn("columns: company, filingdate, rpo_b", str(caught.exception))
        filtered = self.tools.call("query", {"result_id": "query_5",
            "sql": "SELECT * FROM data WHERE company = 'Oracle'"})
        self.assertEqual(filtered["row_count"], 2)
        result = self.tools.call("plot", {**PLOT, "result_id": filtered["result_id"]})
        self.assertEqual(result["artifact_id"], 1)

    def test_invalid_arguments_are_specific(self):
        cases = [
            ({**PLOT, "result_id": "query_99"}, "existing saved result_id.*query_5"),
            ({**PLOT, "result_id": "query_5", "y": "missing"}, "Available columns: company, filingdate, rpo_b"),
            ({**PLOT, "result_id": "query_5", "extra": True}, r"unknown field\(s\): extra"),
            ({**PLOT, "result_id": None}, "plot.result_id must be a string"),
        ]
        for arguments, message in cases:
            with self.subTest(arguments=arguments), self.assertRaisesRegex(ValueError, message):
                self.tools.call("plot", arguments)
        with self.assertRaisesRegex(ValueError, "No results are saved yet"):
            Tools("test-key").call("plot", PLOT)
        self.assertEqual(self.tools.artifacts, [])

    def test_markdown_rejects_svg_chart_but_accepts_reports_and_code(self):
        with self.assertRaisesRegex(ValueError, "cannot render SVG charts.*plot"):
            self.tools.call("write_markdown", {"title": "Chart", "markdown": "# RPO\n<svg><path/></svg>"})
        self.assertEqual(self.tools.artifacts, [])
        self.tools.call("write_markdown", {"title": "Report", "markdown": "# RPO\nA text report."})
        self.tools.call("write_markdown", {"title": "Example", "markdown": "```html\n<svg></svg>\n```"})
        self.assertEqual(len(self.tools.artifacts), 2)

    def test_agent_recovers_from_rejected_plot_and_emits_separate_artifacts(self):
        agent = Agent(api_key="test-data-key", model_api_key="test-model-key")
        agent.tools.results = self.tools.results
        completions = 0

        def complete(tool_choice):
            nonlocal completions
            step = completions
            completions += 1
            if step == 1:
                rejection = json.loads(next(message["content"] for message in agent.messages
                                            if message["role"] == "tool"))
                self.assertIn("missing required field(s): result_id", rejection["error"])
                self.assertIn("query_5", rejection["error"])
            if step == 4:
                return {"choices": [{"message": {"content": "Created three charts."}}]}
            arguments = ({**PLOT, "sql": "SELECT * FROM simple_xbrl"} if step == 0 else
                         {**PLOT, "title": COMPANIES[step - 1], "result_id": "query_5",
                          "sql": f"SELECT * FROM data WHERE company = '{COMPANIES[step - 1]}'"})
            return {"choices": [{"message": {"tool_calls": [{"id": f"call_{step}", "type": "function",
                    "function": {"name": "plot", "arguments": json.dumps(arguments)}}]}}]}

        with patch.object(agent, "_complete", side_effect=complete):
            events = list(agent.run("Plot each company separately."))
        outcomes = [event for event in events if event["type"] == "tool_result"]
        self.assertEqual(len(outcomes), 4)
        self.assertIn("result_id", outcomes[0]["result"]["error"])
        self.assertTrue(all(event["result"].get("artifact_id") for event in outcomes[1:]))
        self.assertEqual([event["artifact"]["title"] for event in events if event["type"] == "artifact"], COMPANIES)
        self.assertFalse(any(event["type"] == "error" for event in events))
        self.assertEqual(completions, 5)

    def test_tool_contract_and_instructions_match_typescript(self):
        config = (Path(__file__).resolve().parents[2] / "typescript/src/config.ts").read_text(encoding="utf-8")
        prefix = "export const INSTRUCTIONS = "
        line = next(line for line in config.splitlines() if line.startswith(prefix))
        self.assertEqual(INSTRUCTIONS, json.loads(line[len(prefix):-1]))
        definitions = json.loads(config.split("export const TOOL_DEFINITIONS = ", 1)[1].strip().removesuffix(";"))
        self.assertEqual(TOOL_DEFINITIONS, definitions)


if __name__ == "__main__":
    unittest.main()
