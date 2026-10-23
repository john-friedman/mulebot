# Mulebot

A simple chatbot that interfaces with [Datamule's](https://datamule.xyz/) APIs. Originally [How to deploy a financial chatbot in 5 minutes](https://medium.com/@jgfriedman99/how-to-deploy-a-financial-chatbot-in-5-minutes-ef5eec973d4c).

## Run

Set up environment
```bash
export DATAMULE_API_KEY="your-datamule-key"
export OPENROUTER_API_KEY="your-openrouter-key"
```
Install
```python
pip install mulebot
```
```typescript
npm install mulebot
```


Deploy
```python
python -m mulebot serve
```

```typescript
npm run serve
```


## Help, it's slow!

Datamule's SQL is built on top of AWS Athena, which is relatively cheap on demand, but slow. If you transfer Datamule's [data to your cloud](https://datamule.xyz/docs/transfer-to-your-cloud/), then store in a proper database, queries should be on the order of ms. Also per query should be much cheaper.


## Customize an agent

Each agent starts with Mulebot's instructions, Datamule documentation, and three
tools: `query`, `write_markdown`, and `plot`. Configure an instance with these
methods; each returns the agent so calls can be chained.

| Python | JavaScript | Behavior |
| --- | --- | --- |
| `set_instructions(text)` | `setInstructions(text)` | Replace instructions |
| `append_instructions(text)` | `appendInstructions(text)` | Append instructions with a blank line |
| `set_doc(text)` | `setDoc(text)` | Replace documentation |
| `append_doc(text)` | `appendDoc(text)` | Append documentation with a blank line |
| `set_tools(tools)` | `setTools(tools)` | Replace every active tool, including built-ins |
| `append_tools(tools)` | `appendTools(tools)` | Add tools to the active collection |

`bot.tools` lists all active tools, including built-ins. It returns a snapshot;
use the methods above to change the collection. Duplicate names raise an error.
Use `set_tools([])` / `setTools([])` to disable tools entirely. Replacing tools
does not clear saved results or artifacts. If you remove built-ins, update your
instructions to describe the tools that remain available.

Instructions and documentation are separate from conversation history. Changing
them updates the system message without clearing the chat. Loading saved chat
state keeps the receiving agent's instructions, documentation, and tools.
Credentials, tool implementations, and system content are not included in saved
state; configure each new agent before restoring it.

### Python

Use `@tool` to declare a synchronous function. The function name, docstring, and
parameter type hints supply its name, description, and input schema. Parameters
with defaults are optional. Tools return JSON-serializable values.

```python
from mulebot import Agent, tool


@tool
def percent_change(start: float, end: float) -> float:
    """Calculate the percentage change from a starting value to an ending value."""
    return 100 * (end - start) / start


bot = Agent()
bot.set_instructions("You are a financial research assistant.")
bot.append_instructions("Use percent_change to calculate growth rates.")
bot.set_doc("Revenue and operating income are in USD; EPS is USD per share.")
bot.append_doc("Gross margin is expressed as a percentage.")
bot.append_tools([percent_change])

print([entry.name for entry in bot.tools])
# ['query', 'write_markdown', 'plot', 'percent_change']

# Keep only this tool, or select any subset of bot.tools.
bot.set_tools([percent_change])
response = bot.chat("What is the percentage change from 100 to 120?")
```

Supported type hints include `str`, `int`, `float`, `bool`, `list`, `dict` with
string keys, `Literal`, and unions (including optional values). For other input
structures, pass a JSON Schema to `@tool(parameters=...)`, or construct a `Tool`
with `name`, `description`, `parameters`, and `execute`. The execute function
receives inputs as keyword arguments. Python tools follow the agent's synchronous
execution model. A tool can access `bot.results` and `bot.artifacts` through a
closure.

### JavaScript / TypeScript

Declare the tool's input schema and execute function together. Execute functions
can be synchronous or async. Only the name, description, and schema are sent to
the model; execution stays in your application.

```javascript
import { Agent } from 'mulebot';

const percentChange = {
  name: 'percent_change',
  description: 'Calculate the percentage change between two values.',
  parameters: {
    type: 'object',
    properties: {
      start: { type: 'number' },
      end: { type: 'number' },
    },
    required: ['start', 'end'],
    additionalProperties: false,
  },
  execute({ start, end }) {
    if (start === 0) throw new Error('The starting value must be nonzero.');
    return 100 * (end - start) / start;
  },
};

const bot = new Agent();
bot.setInstructions('You are a financial research assistant.');
bot.appendInstructions('Use percent_change to calculate growth rates.');
bot.setDoc('Revenue and operating income are in USD; EPS is USD per share.');
bot.appendDoc('Gross margin is expressed as a percentage.');
bot.appendTools([percentChange]);

console.log(bot.tools.map(tool => tool.name));
// ['query', 'write_markdown', 'plot', 'percent_change']

bot.setTools([percentChange]);
const response = await bot.chat('What is the percentage change from 100 to 120?');
```

TypeScript exports the `Tool` and `ToolContext` types. Execute functions receive
an optional second argument in their declaration: `execute(arguments, context)`.
The context contains `results`, `artifacts`, and the agent's cancellation `signal`.
Push supported artifacts into `context.artifacts` to emit them through the
existing artifact stream. Results must be JSON-serializable; exceptions become
tool errors the model can use to correct its next call.

For HTTP integrations, configure each agent in `handleChat`'s `agentFactory`.
Existing constructor options for credentials, model, custom fetch, allowed
tables, and cancellation still apply to the built-in tools.

### Updating existing integrations

`bot.tools` is now the active tool collection. Saved query results and artifacts
are available as `bot.results` and `bot.artifacts`, replacing
`bot.tools.results` and `bot.tools.artifacts`. Use the instruction methods instead
of editing the assembled system message directly: later setters rebuild that
message from `bot.instructions` and `bot.doc`.
