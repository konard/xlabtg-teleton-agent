# 05 - Regressions And Compatibility

## Scope

This report checks whether V2 changes preserve existing external behavior and
whether newly added feature surfaces can be consumed consistently by existing
users, scripts, and operators.

## Confirmed Compatibility Findings

The main confirmed compatibility issue is
[WORK3-H3](04-ui-api-parity.md#work3-h3-management-api-does-not-expose-most-v2-webui-routes).
It is recorded in the UI/API parity report because that is the primary failure
mode, but it is also a compatibility problem:

- Existing Management API users expect production HTTPS access to operational
  capabilities.
- New V2 browser features are not consistently reachable through `/v1`, so
  scripts and remote operators cannot automate the same workflows shown in the
  WebUI.
- `ApiServerDeps` does not include `networkConfig`, which means later attempts
  to expose the network route under `/v1` need dependency-shape changes, not
  just another route mount.

## Regression Notes

- Prior audit issues from `improvements/work` and `improvements/work2` were not
  re-filed. The confirmed findings here are distinct from the closed audit
  findings `#252` through `#329`.
- The network findings are tied to the V2-21 feature added in PR
  [#397](https://github.com/xlabtg/teleton-agent/pull/397), not to older
  autonomous-mode findings from the first two audits.
- The widget preview finding is tied to the V2-18 widget generator added in PR
  [#391](https://github.com/xlabtg/teleton-agent/pull/391), not to the dynamic
  dashboard base engine itself.

## Recommended Compatibility Guard

Add an explicit route parity allowlist near `src/api/server.ts` so the
Management API can intentionally omit browser-only routes while catching
accidental drift. The test should fail with the missing route group names.
