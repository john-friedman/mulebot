# Mulebot

A simple chatbot that interfaces with [Datamule's](https://datamule.xyz/) APIs. Originally [How to deploy a financial chatbot in 5 minutes](https://medium.com/@jgfriedman99/how-to-deploy-a-financial-chatbot-in-5-minutes-ef5eec973d4c).

## Run

Set up environment
```bash
export DATAMULE_API_KEY="your-datamule-key"
export OPENROUTER_API_KEY="your-openrouter-key"
# Or OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY for your chosen provider.
```
Keys can also be passed as `api_key` / `model_api_key` (Python) or
`apiKey` / `modelApiKey` (JavaScript), overriding environment variables.

Install
```python
pip install mulebot
```
```typescript
npm install mulebot
```


Deploy
```python
python -m mulebot --provider openrouter serve
```

```typescript
npm run serve -- --provider openrouter
```


## Help, it's slow!

Datamule's SQL is built on top of AWS Athena, which is relatively cheap on demand, but slow. If you transfer Datamule's [data to your cloud](https://datamule.xyz/docs/transfer-to-your-cloud/), then store in a proper database, queries should be on the order of ms. Also per query should be much cheaper.


## Customize an agent

Each agent starts with Mulebot's instructions, Datamule documentation, and three
tools: `query`, `write_markdown`, and `plot`. 

| Python | JavaScript | Behavior |
| --- | --- | --- |
| `set_instructions(text)` | `setInstructions(text)` | Replace instructions |
| `append_instructions(text)` | `appendInstructions(text)` | Append instructions with a blank line |
| `set_documentation(text)` | `setDocumentation(text)` | Replace documentation |
| `append_documentation(text)` | `appendDocumentation(text)` | Append documentation with a blank line |
| `set_tools(tools)` | `setTools(tools)` | Replace every active tool, including built-ins |
| `append_tools(tools)` | `appendTools(tools)` | Add tools to the active collection |
