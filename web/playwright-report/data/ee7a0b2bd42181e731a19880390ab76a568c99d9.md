# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a11y.spec.ts >> a11y: Feedback (/feedback)
- Location: e2e/a11y.spec.ts:139:3

# Error details

```
Error: Critical/serious a11y violations on Feedback:
color-contrast (serious)

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 12

- Array []
+ Array [
+   Object {
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.11/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": 1,
+     "targets": Array [
+       "button",
+     ],
+   },
+ ]
```

# Test source

```ts
  81  | 
  82  |   writeFileSync(
  83  |     resolve(outDir, "baseline.json"),
  84  |     JSON.stringify({ generatedAt, wcagTags: WCAG_TAGS, totalBlocking, totalAdvisory, pages: reports }, null, 2),
  85  |   );
  86  | 
  87  |   const lines: string[] = [];
  88  |   lines.push("# WebUI Accessibility Audit Baseline");
  89  |   lines.push("");
  90  |   lines.push(`Generated: ${generatedAt}`);
  91  |   lines.push("");
  92  |   lines.push(`Rule set: ${WCAG_TAGS.join(", ")} (WCAG 2.1 Level A & AA)`);
  93  |   lines.push("");
  94  |   lines.push(`- Pages audited: **${reports.length}**`);
  95  |   lines.push(`- Blocking violations (critical/serious): **${totalBlocking}**`);
  96  |   lines.push(`- Advisory violations (moderate/minor): **${totalAdvisory}**`);
  97  |   lines.push("");
  98  |   lines.push("| Page | Path | Blocking | Advisory |");
  99  |   lines.push("| ---- | ---- | -------- | -------- |");
  100 |   for (const r of reports) {
  101 |     lines.push(`| ${r.page} | \`${r.path}\` | ${r.blocking.length} | ${r.advisory.length} |`);
  102 |   }
  103 |   lines.push("");
  104 |   const withBlocking = reports.filter((r) => r.blocking.length > 0);
  105 |   if (withBlocking.length > 0) {
  106 |     lines.push("## Blocking violations");
  107 |     lines.push("");
  108 |     for (const r of withBlocking) {
  109 |       lines.push(`### ${r.page} (\`${r.path}\`)`);
  110 |       lines.push("");
  111 |       for (const v of r.blocking) {
  112 |         lines.push(`- **${v.id}** (${v.impact}) — ${v.help}`);
  113 |         lines.push(`  - Nodes: ${v.nodes}; e.g. \`${v.targets.slice(0, 3).join("`, `")}\``);
  114 |         lines.push(`  - ${v.helpUrl}`);
  115 |       }
  116 |       lines.push("");
  117 |     }
  118 |   } else {
  119 |     lines.push("✅ No critical or serious violations found.");
  120 |     lines.push("");
  121 |   }
  122 |   writeFileSync(resolve(outDir, "summary.md"), lines.join("\n"));
  123 | });
  124 | 
  125 | function summarize(
  126 |   violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
  127 | ): ViolationSummary[] {
  128 |   return violations.map((v) => ({
  129 |     id: v.id,
  130 |     impact: v.impact ?? "unknown",
  131 |     help: v.help,
  132 |     helpUrl: v.helpUrl,
  133 |     nodes: v.nodes.length,
  134 |     targets: v.nodes.flatMap((n) => n.target.map((t) => String(t))),
  135 |   }));
  136 | }
  137 | 
  138 | for (const route of ROUTES) {
  139 |   test(`a11y: ${route.name} (${route.path})`, async ({ page }) => {
  140 |     await mockBackend(page);
  141 |     // Disable CSS animations/transitions at the engine level so axe never samples
  142 |     // a colour mid-fade (entrance animations briefly lower opacity and produce
  143 |     // flaky `color-contrast` violations). This also mirrors WCAG 2.3.3 behaviour.
  144 |     await page.emulateMedia({ reducedMotion: "reduce" });
  145 |     await page.goto(route.path, { waitUntil: "domcontentloaded" });
  146 | 
  147 |     // Give the SPA time to fetch mock data and render past loading states.
  148 |     await page.waitForLoadState("networkidle").catch(() => {});
  149 | 
  150 |     // Belt-and-braces: force every animation/transition to zero duration and
  151 |     // fast-forward any still-running animation to its final frame before scanning.
  152 |     await page.addStyleTag({
  153 |       content:
  154 |         "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }",
  155 |     });
  156 |     await page.waitForTimeout(500);
  157 |     await page.evaluate(() => {
  158 |       for (const a of document.getAnimations()) {
  159 |         try {
  160 |           a.finish();
  161 |         } catch {
  162 |           /* ignore animations that cannot be finished */
  163 |         }
  164 |       }
  165 |     });
  166 |     await page.waitForTimeout(150);
  167 | 
  168 |     const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  169 | 
  170 |     const blocking = summarize(results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? "")));
  171 |     const advisory = summarize(results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? "")));
  172 |     reports.push({ page: route.name, path: route.path, blocking, advisory });
  173 | 
  174 |     if (blocking.length > 0) {
  175 |       const detail = blocking
  176 |         .map((v) => `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.targets.slice(0, 5).join(", ")}`)
  177 |         .join("\n");
  178 |       test.info().annotations.push({ type: "a11y-violations", description: detail });
  179 |     }
  180 | 
> 181 |     expect(blocking, `Critical/serious a11y violations on ${route.name}:\n${blocking.map((v) => `${v.id} (${v.impact})`).join(", ")}`).toEqual([]);
      |                                                                                                                                        ^ Error: Critical/serious a11y violations on Feedback:
  182 |   });
  183 | }
  184 | 
```