# Mulebot

A simple chatbot that interfaces with [Datamule's](https://datamule.xyz/) APIs. Originally [How to deploy a financial chatbot in 5 minutes](https://medium.com/@jgfriedman99/how-to-deploy-a-financial-chatbot-in-5-minutes-ef5eec973d4c).

## Run

```bash
export DATAMULE_API_KEY="your-datamule-key"
export OPENROUTER_API_KEY="your-openrouter-key"
```


```python
python -m mulebot serve
```

```typescript
npm run serve
```


## Help, it's slow!

Datamule's SQL is built on top of AWS Athena, which is relatively cheap on demand, but slow. If you transfer Datamule's [data to your cloud](https://datamule.xyz/docs/transfer-to-your-cloud/), then store in a proper database, queries should be on the order of ms. Also per query should be much cheaper.
