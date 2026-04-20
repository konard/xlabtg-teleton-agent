# Autonomous Mode Strategy Profiles

Teleton Agent supports three strategy profiles that control how cautiously the autonomous loop operates.

---

## `conservative`

**Best for:** tasks involving financial transactions, external API calls, or anything that may be hard to reverse.

- Requests user confirmation more frequently
- Stops and escalates on any ambiguous situation
- Prefers slower, more deliberate action sequences
- Recommended for: sending TON, posting public messages, modifying live contracts

**Example use case:**
```sh
teleton autonomous enable \
  --task="Send daily TON rewards to top 10 stakers" \
  --strategy=conservative \
  --max-hours=1 \
  --success-criteria="10 transactions confirmed"
```

---

## `balanced` (default)

**Best for:** most monitoring, data collection, and reporting tasks.

- Confirms only for explicitly restricted tools or high-value transactions
- Adapts strategy based on LLM confidence score
- Pauses when confidence drops below 0.7 for 3 consecutive steps
- Recommended for: pool monitoring, web scraping, on-chain analytics

**Example use case:**
```sh
teleton autonomous enable \
  --task="Monitor TON whale wallets and alert on large moves" \
  --strategy=balanced \
  --max-hours=24
```

---

## `aggressive`

**Best for:** fully automated workflows where speed matters and risks are low.

- Minimal confirmation requests
- Continues even on uncertain reflections (up to limit)
- Higher tool call rate allowed
- Recommended for: internal data collection, non-financial automation, dev/test environments

**Example use case:**
```sh
teleton autonomous enable \
  --task="Scrape and index all TON DNS names updated in the last 24h" \
  --strategy=aggressive \
  --max-iterations=200 \
  --max-hours=4
```

---

## Comparison Table

| Feature | conservative | balanced | aggressive |
|---------|-------------|----------|------------|
| Confirmation frequency | High | Medium | Low |
| Uncertainty escalation threshold | 1 | 3 | 5 |
| Suitable for TON transactions | Yes (all) | Above 0.5 TON | Only with explicit allow |
| Speed | Slowest | Medium | Fastest |
| Risk level | Lowest | Medium | Higher |
| Recommended default | Financial tasks | General | Internal/dev |
