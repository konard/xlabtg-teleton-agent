# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** Starting from the next release, new entries in this file are
> generated automatically by [release-please](https://github.com/googleapis/release-please-action)
> from [Conventional Commits](https://www.conventionalcommits.org/). Do not edit
> released sections by hand — write good commit messages instead (see
> [CONTRIBUTING.md](CONTRIBUTING.md#commit-conventions)). The entries below this
> note are preserved as the historical, manually-maintained record.

## [0.8.31](https://github.com/xlabtg/teleton-agent/compare/v0.8.30...v0.8.31) (2026-06-04)


### Bug Fixes

* **workflows:** блокировать ssrf в call_api ([d0a7481](https://github.com/xlabtg/teleton-agent/commit/d0a74815c4a7f1bcacf8bfe058fa1aa027c92148))
* **workflows:** блокировать SSRF в call_api ([53cdbce](https://github.com/xlabtg/teleton-agent/commit/53cdbce36d6949935a9b8237cbc538ad4b62a93e))

## [0.8.30](https://github.com/xlabtg/teleton-agent/compare/v0.8.29...v0.8.30) (2026-06-04)


### Bug Fixes

* **mcp:** валидировать url и env перед сохранением ([a220061](https://github.com/xlabtg/teleton-agent/commit/a2200619f4b819a3f1b96c8421b0d15b1a56d77a))
* **mcp:** валидировать URL и env при добавлении MCP server ([58c4905](https://github.com/xlabtg/teleton-agent/commit/58c4905d32fac636398219234111314f52424632))


### Documentation

* синхронизировать версию README ([916a0f5](https://github.com/xlabtg/teleton-agent/commit/916a0f5a2d3dcef1058fbb31311881f59b041882))

## [0.8.29](https://github.com/xlabtg/teleton-agent/compare/v0.8.28...v0.8.29) (2026-06-04)


### Bug Fixes

* **exec:** соблюдать allowlist пользователей для exec scope ([e70b5a7](https://github.com/xlabtg/teleton-agent/commit/e70b5a75b1a0abd97bc827f89d66b4abc49e2b33))
* **exec:** соблюдать allowlist пользователей для exec scope ([5b56cf4](https://github.com/xlabtg/teleton-agent/commit/5b56cf45b942cbb2a2afd1f3a0721d6165a140c6))


### Documentation

* синхронизировать версию README ([0e455da](https://github.com/xlabtg/teleton-agent/commit/0e455da974cde4e6faabc28a4859645d1035d6ab))

## [0.8.28](https://github.com/xlabtg/teleton-agent/compare/v0.8.27...v0.8.28) (2026-06-03)


### Bug Fixes

* **integrations:** не хранить AES-ключ в той же БД, что и шифртекст (WORK4-003) ([dc6b2fa](https://github.com/xlabtg/teleton-agent/commit/dc6b2fae143a4c8efc5074bf00d517b030bba1d9))
* **integrations:** прекратить хранение AES-ключа в той же БД, что и шифртекст (WORK4-003) ([8aacae9](https://github.com/xlabtg/teleton-agent/commit/8aacae90202b39e7c64a93a7b560b68229b7ffd6)), closes [#525](https://github.com/xlabtg/teleton-agent/issues/525)


### Documentation

* обновить версию форка в README с 0.8.26 до 0.8.27 ([f80cac0](https://github.com/xlabtg/teleton-agent/commit/f80cac099ce54c06a69bca0ff2c4f94874b7e762))

## [0.8.27](https://github.com/xlabtg/teleton-agent/compare/v0.8.26...v0.8.27) (2026-06-03)


### Bug Fixes

* **ci:** update README fork version to 0.8.26 and optimize schema sanitizer ([ee18d4b](https://github.com/xlabtg/teleton-agent/commit/ee18d4b519958e147cdda947b7628a9519d6dbf9))
* **plugin-loader:** restrict migrateFromMainDb to allow-listed tables (WORK4-002) ([418749e](https://github.com/xlabtg/teleton-agent/commit/418749ec03233ed55aabedbb69cb2b2fdaee1163))
* **plugin-loader:** restrict migrateFromMainDb to allow-listed tables (WORK4-002) ([849fb62](https://github.com/xlabtg/teleton-agent/commit/849fb622f141f83dbe4516bd622ae7794609686e)), closes [#524](https://github.com/xlabtg/teleton-agent/issues/524)

## [0.8.26](https://github.com/xlabtg/teleton-agent/compare/v0.8.25...v0.8.26) (2026-06-02)


### Bug Fixes

* **exec:** honor allowlist mode and prevent shell injection in install/service ([b8c45a6](https://github.com/xlabtg/teleton-agent/commit/b8c45a6a844e724ea9873c2ff468e57108277901)), closes [#523](https://github.com/xlabtg/teleton-agent/issues/523)
* **exec:** соблюдение allowlist и защита от shell-инъекций в exec_install/exec_service ([47d1e2b](https://github.com/xlabtg/teleton-agent/commit/47d1e2bd03d095089a379323994e50164b954e03))


### Documentation

* sync README fork version to 0.8.25 (matches package.json) ([e4b7500](https://github.com/xlabtg/teleton-agent/commit/e4b75003d6432deac58f1be4f04460eec7fbf2b8))

## [0.8.25](https://github.com/xlabtg/teleton-agent/compare/v0.8.24...v0.8.25) (2026-06-02)


### Documentation

* sync README fork version to 0.8.24 ([48556a3](https://github.com/xlabtg/teleton-agent/commit/48556a3f90ef1c16d53257e5e1874e246560837c))

## [0.8.24](https://github.com/xlabtg/teleton-agent/compare/v0.8.23...v0.8.24) (2026-06-01)


### Documentation

* синхронизировать версию форка в README (0.8.22 → 0.8.23) ([54fc8e3](https://github.com/xlabtg/teleton-agent/commit/54fc8e3767733ede23917cd9f2cf528ae753d307))

## [0.8.23](https://github.com/xlabtg/teleton-agent/compare/v0.8.22...v0.8.23) (2026-05-30)


### Documentation

* добавить community health файлы ([f2cf7f6](https://github.com/xlabtg/teleton-agent/commit/f2cf7f6d04a7065d7d3835e39f9d71725b513b03))

## [0.8.22](https://github.com/xlabtg/teleton-agent/compare/v0.8.21...v0.8.22) (2026-05-30)


### Features

* **webui:** externalize заголовки страниц и мастер Setup, CI-проверка паритета i18n и документация ([6cc83a1](https://github.com/xlabtg/teleton-agent/commit/6cc83a1649fc2b163eaa888cd5d4a6c77a78da1c))
* **webui:** добавить инфраструктуру i18n (i18next), переключатель EN/RU, externalize навигации и логина ([1136b62](https://github.com/xlabtg/teleton-agent/commit/1136b622d589eaae1e8881a7cab5bf673c1e00b2))


### Documentation

* **readme:** синхронизировать версию форка с 0.8.21 ([b271e13](https://github.com/xlabtg/teleton-agent/commit/b271e13b186c22b329ac98877cf6e1e9ecdbc42c))

## [0.8.21](https://github.com/xlabtg/teleton-agent/compare/v0.8.20...v0.8.21) (2026-05-30)


### Features

* **a11y:** accessibility audit WCAG 2.1 AA + CI-проверка для WebUI ([0f8163c](https://github.com/xlabtg/teleton-agent/commit/0f8163c7bf69ba48de0a5994d57fcfb232822034))


### Bug Fixes

* **a11y:** исправить контраст .step-label.active на тёмном фоне ([4503f6b](https://github.com/xlabtg/teleton-agent/commit/4503f6b362fdd882922815515c9847874e3e38a1))
* **a11y:** устранить нарушения контраста WCAG 2.1 AA в WebUI ([c1ee77b](https://github.com/xlabtg/teleton-agent/commit/c1ee77bfec114ff4eebef4949890ba835a6530e4))
* **ci:** добавить generate:openapi, lint:openapi, compose.yaml и helm-чарт ([7b9736c](https://github.com/xlabtg/teleton-agent/commit/7b9736cbaf9e2b07a0009c3239b11ccc314d12ef))

## [0.8.20](https://github.com/xlabtg/teleton-agent/compare/v0.8.19...v0.8.20) (2026-05-30)


### Features

* add adaptive prompting engine ([6c2d005](https://github.com/xlabtg/teleton-agent/commit/6c2d0053c0ba8a3f3a993cb8ffffdf901139777c))
* add adaptive prompting engine ([541b53f](https://github.com/xlabtg/teleton-agent/commit/541b53f7eccf7ce5899afbd09fe581a94e3c7a87))
* add AI widget generator ([efd56b1](https://github.com/xlabtg/teleton-agent/commit/efd56b1bd1930373391593101324a8b0a98b616b))
* add comprehensive audit trail ([1e619fe](https://github.com/xlabtg/teleton-agent/commit/1e619feb44a01b19f10a329fed39202d0b17c1cc))
* add comprehensive audit trail ([8b82837](https://github.com/xlabtg/teleton-agent/commit/8b828377a503ba56aa186bfffb94990d1399e39c))
* add dynamic dashboard engine ([6e27587](https://github.com/xlabtg/teleton-agent/commit/6e27587efa3672a21285dd9b53488bb2c028f6dc))
* add dynamic dashboard engine ([bc02879](https://github.com/xlabtg/teleton-agent/commit/bc0287936e6312871a2f8486f4ac6c6a2f75fbb5))
* add feedback learning system ([82c867a](https://github.com/xlabtg/teleton-agent/commit/82c867aaf0f8ccf02e0ccbb330bdbe00f55ef229))
* add feedback learning system ([d526535](https://github.com/xlabtg/teleton-agent/commit/d526535ffd919f4f73665abc727600b5e7d6a49b))
* add multi-agent network protocol ([602d9dc](https://github.com/xlabtg/teleton-agent/commit/602d9dc77c9f5046baa7d79b3bfee24b01becc8c))
* add multi-agent network protocol ([d396888](https://github.com/xlabtg/teleton-agent/commit/d396888a5e3e607c0f7a971c6e2848f0af4fcac6))
* add pipeline execution ([574678c](https://github.com/xlabtg/teleton-agent/commit/574678c37f1224909e733fb8571720e08994bad7))
* add pipeline execution engine ([9fe4d21](https://github.com/xlabtg/teleton-agent/commit/9fe4d2169f66c3124cf4759edc95e82ce73bcefc))
* add temporal context engine ([e32d589](https://github.com/xlabtg/teleton-agent/commit/e32d5897d8df86d283a784dd1be3150aed766c91))
* add temporal context engine ([3e745d5](https://github.com/xlabtg/teleton-agent/commit/3e745d5b6f11bd83d73b5e880a69fd67befd968f))
* add unified integration layer ([e1cc8af](https://github.com/xlabtg/teleton-agent/commit/e1cc8af68c3afab96b5573c7b22d665407441624))
* add unified integration layer ([e6a76fd](https://github.com/xlabtg/teleton-agent/commit/e6a76fdf762ce5c7013a5d5e316f6578c0ed67fe))
* **agent:** add self-correction loop ([128b2c3](https://github.com/xlabtg/teleton-agent/commit/128b2c3c80904f46f9f72183632f4971daaf62c6))
* **agent:** add self-correction loop ([a159a59](https://github.com/xlabtg/teleton-agent/commit/a159a598c2391efc626d2126367dc0a3f45f8241))
* **agents:** add agent registry archetypes ([5530341](https://github.com/xlabtg/teleton-agent/commit/5530341d94324fbc4fad3af390621b9d59d6d2dc))
* **agents:** add bot runtime controls for managed agents ([621b76f](https://github.com/xlabtg/teleton-agent/commit/621b76fd037d13d300f839d5bd4cfbabc9644146))
* **agents:** add managed multi-agent registry ([0071a8d](https://github.com/xlabtg/teleton-agent/commit/0071a8d9496a241d4f90805e46f983ba0ab3a77b))
* **agents:** add managed personal auth flow ([f1d6c68](https://github.com/xlabtg/teleton-agent/commit/f1d6c6816ace262320e3612fa95bf127fb5b2c67))
* **agents:** add managed personal QR auth ([345b5f0](https://github.com/xlabtg/teleton-agent/commit/345b5f0c0dd09a74bcd278a4209f5d39c0980acb))
* **agents:** add managed runtimes and personal auth ([e1b8ee3](https://github.com/xlabtg/teleton-agent/commit/e1b8ee3f8937bbbd1062b1b7b990f4ae1b58aef9))
* **agents:** add registry archetypes ([038e2b4](https://github.com/xlabtg/teleton-agent/commit/038e2b4233e1e465da72923399e2858e64dc4b1b))
* **api:** code-first генератор OpenAPI 3.1 и Swagger UI ([60eba9b](https://github.com/xlabtg/teleton-agent/commit/60eba9b684823b3ec9ff6d423b0aadb55d5cb87e))
* **backup:** резервное копирование, восстановление и откат миграций ([4ea07f4](https://github.com/xlabtg/teleton-agent/commit/4ea07f4b57d67b64f2dc0ea417448db65247c5aa))
* **bot:** route Telegram Bot API HTTPS through optional proxy ([3e297b1](https://github.com/xlabtg/teleton-agent/commit/3e297b108c4ae6305585c988fff7d9c86a3ed300))
* **deploy:** добавить Docker Compose стек, Helm chart и multi-arch/cosign образ ([e530352](https://github.com/xlabtg/teleton-agent/commit/e530352e5060c0b4961bf7e4a8ae8593dec89946)), closes [#498](https://github.com/xlabtg/teleton-agent/issues/498)
* **mtproto:** show proxy health in config ([7518889](https://github.com/xlabtg/teleton-agent/commit/75188893774a63155390d0d469f0ffbfc10741cd))
* **network:** show local agent on Network page + remote setup docs ([d79a73c](https://github.com/xlabtg/teleton-agent/commit/d79a73ce46158a7c10d7e43d24b652bbe5695cf2))
* **network:** show local agent on the Network page and document remote agent setup ([8e587ec](https://github.com/xlabtg/teleton-agent/commit/8e587ec02f738499f9d1f5f283ffb172226b7a9f))
* **observability:** добавить /metrics endpoint и Prometheus-метрики ([bce2db3](https://github.com/xlabtg/teleton-agent/commit/bce2db35a67fef4a02cf4ae1d5d4cea4060ea784))
* **security:** add zero-trust execution layer ([0ed214a](https://github.com/xlabtg/teleton-agent/commit/0ed214a1001db247af4609dfd24c9fcd6c08d802))
* **security:** add zero-trust tool validation ([800d078](https://github.com/xlabtg/teleton-agent/commit/800d0784adcdeed147564c22fce9c3ac7131a641))
* **seo:** автоматизировать валидацию SEO-базлайна (sitemap/robots/noindex) ([98fc52f](https://github.com/xlabtg/teleton-agent/commit/98fc52fc2418f93357c4a8f4d4304343fd76ef1f))
* **seo:** автоматизировать валидацию SEO-базлайна (sitemap/robots/noindex) ([9e2d2fc](https://github.com/xlabtg/teleton-agent/commit/9e2d2fce439e6ec85474cf71b03e5b7e73c338c4))
* **site:** публичная маркетинговая лендинг-страница teletonagent.dev ([b343ed2](https://github.com/xlabtg/teleton-agent/commit/b343ed2c459f7f97b89f2bdc2153b568423f10b9))
* **site:** публичная маркетинговая лендинг-страница teletonagent.dev ([305384e](https://github.com/xlabtg/teleton-agent/commit/305384eb2d8cf9b2e47528329001867cc715aebc)), closes [#491](https://github.com/xlabtg/teleton-agent/issues/491)
* **tasks:** add task delegation engine ([eee198d](https://github.com/xlabtg/teleton-agent/commit/eee198d259fb2d82a6fd86958d4586d401516f4b))
* **tasks:** add task delegation engine ([b56c17b](https://github.com/xlabtg/teleton-agent/commit/b56c17bbaf2702d6638176cb4773376d79a82d91))
* **test:** добавить E2E-набор Playwright для WebUI ([d6a228a](https://github.com/xlabtg/teleton-agent/commit/d6a228ae76379d9708fa3d389c8076bebd772691))
* **tts:** drop ffmpeg dependency for Telegram voice notes ([1041161](https://github.com/xlabtg/teleton-agent/commit/1041161b09f40166db4d775dab4c98ee5bb7d7ac))
* **tts:** drop ffmpeg dependency for Telegram voice notes ([5d319d9](https://github.com/xlabtg/teleton-agent/commit/5d319d92c96614f1127281cb5044a1dd19beafd3))
* **voice:** auto-convert WAV voicePath to OGG/Opus in telegram_send_voice ([e4da6d7](https://github.com/xlabtg/teleton-agent/commit/e4da6d793c2c5e235e51572985c4701c614d2ae6))
* **voice:** автоконвертация WAV → OGG/Opus в telegram_send_voice ([d72cbe6](https://github.com/xlabtg/teleton-agent/commit/d72cbe6c7bb305efe453088dc6328332d52beb5e))


### Bug Fixes

* **agents:** harden managed bot runtime setup ([07e2e28](https://github.com/xlabtg/teleton-agent/commit/07e2e2815a576d5a0f34a169d6bf459d02a7cdf0))
* **agents:** invalidate stale personal auth sessions ([b617c47](https://github.com/xlabtg/teleton-agent/commit/b617c47f215297454854c47e7caf66a7e863f21a))
* **agents:** make managed agent modes explicit ([8423bec](https://github.com/xlabtg/teleton-agent/commit/8423bec7dc6b6059d5c94f9bbdb1c8a4044beada))
* **agents:** resolve CI typecheck issues ([5f8ed30](https://github.com/xlabtg/teleton-agent/commit/5f8ed300db80d43146429c0b08b68ea91d4f54d9))
* **alerting:** add SSRF guard, 5s timeout, and secret redaction to webhook dispatch ([8a6ccf9](https://github.com/xlabtg/teleton-agent/commit/8a6ccf927490afc2d718e81bb058e2166c3b83b3))
* **alerting:** clear fetchSpy between tests and apply Prettier formatting ([e6a8f24](https://github.com/xlabtg/teleton-agent/commit/e6a8f247109fc95c643313313ea63b29798415de))
* **alerting:** SSRF guard, 5 s timeout, secret redaction for webhook dispatch ([44f4656](https://github.com/xlabtg/teleton-agent/commit/44f465600bb01c563afbd8ed3f4525de114f2305))
* allow public webhook ingress through webui middleware ([fb274fb](https://github.com/xlabtg/teleton-agent/commit/fb274fb695d801e22f1d658065bf2dd37e3f0dbd))
* allow signed V2 webhook ingress through WebUI middleware ([a531ee7](https://github.com/xlabtg/teleton-agent/commit/a531ee7226ec338ca0c8c138d1b7df34c27601ab))
* allow Windows TELETON_HOME paths ([d66b066](https://github.com/xlabtg/teleton-agent/commit/d66b0660f67e95f84207d8a05216dcf876865735))
* **analytics:** fix Detection Timeline/Alert Config width and Tool Call Counts data source ([3c634eb](https://github.com/xlabtg/teleton-agent/commit/3c634eb3b5f7466e374a1e0a5b50732fd9d20ee1))
* **analytics:** fix Detection Timeline/Alert Config width and Tool Call Counts data source ([ccec081](https://github.com/xlabtg/teleton-agent/commit/ccec081d6c570033acee13d0c063496f6b2210e1))
* **analytics:** limit Detection Timeline height to 10 rows with internal scroll ([bc4b08a](https://github.com/xlabtg/teleton-agent/commit/bc4b08a23d379888c806d28d1db851a7bea709f7))
* **analytics:** query request_metrics for getCostPerTool instead of nonexistent metric_tool_calls ([93bf014](https://github.com/xlabtg/teleton-agent/commit/93bf014c6a76555fbe458d003350f8a1db5608a5))
* **api:** add concurrency lock to /v1/agent/restart (AUDIT-FULL-H6) ([0c4f840](https://github.com/xlabtg/teleton-agent/commit/0c4f840e44eafe11eb7503681cee6e03031fa0f2))
* **api:** add concurrency lock to /v1/agent/restart to prevent parallel stop/start races ([31e1a4d](https://github.com/xlabtg/teleton-agent/commit/31e1a4daebf321e277714e0529db3e725cae61a3)), closes [#314](https://github.com/xlabtg/teleton-agent/issues/314)
* **app:** keep WebUI/Management API alive when Telegram fails to start ([d83cf3e](https://github.com/xlabtg/teleton-agent/commit/d83cf3ea860b7e2aef404b9bfb8b1c2beb364f28))
* **app:** keep WebUI/Management API alive when Telegram fails to start ([0adee07](https://github.com/xlabtg/teleton-agent/commit/0adee072aee5ad53a91a4f8327f77e19c2b8c80a))
* **audio:** handle streaming WAV placeholder size 0xFFFFFFFF from Groq TTS ([69282a4](https://github.com/xlabtg/teleton-agent/commit/69282a446a22276c2e5c1ea0426b26535043dc47))
* **audio:** handle streaming WAV placeholder size 0xFFFFFFFF from Groq TTS ([4c9147b](https://github.com/xlabtg/teleton-agent/commit/4c9147b6d503365e5412687ebac14cc9d31ee3c7))
* **bot:** avoid blocking startup on Bot API getMe ([20b4739](https://github.com/xlabtg/teleton-agent/commit/20b47398585de216bbf2047d39061bf93c775532))
* **bot:** avoid blocking startup on Bot API getMe ([c9cbc80](https://github.com/xlabtg/teleton-agent/commit/c9cbc8012f8e982855103a6b06f8433188d024a6))
* **bot:** avoid blocking startup on GramJS MTProxy ([c529edc](https://github.com/xlabtg/teleton-agent/commit/c529edc1c492103b25ea2f45d371b483a5a58ed0))
* **bot:** route Telegram Bot API HTTPS through optional proxy ([b648b5c](https://github.com/xlabtg/teleton-agent/commit/b648b5c60644143e936e4e054ec2394255d3bcaf))
* **bot:** silence "Aborted delay" polling log on Ctrl+C shutdown ([62ffa30](https://github.com/xlabtg/teleton-agent/commit/62ffa30272db203c330c9c412be90285ddf9f638))
* **bot:** silence "Aborted delay" polling log on Ctrl+C shutdown ([024d1a1](https://github.com/xlabtg/teleton-agent/commit/024d1a120d097c41fa9de6f4c371ac0e36809cea))
* bound pipeline steps by run timeout ([ce776cf](https://github.com/xlabtg/teleton-agent/commit/ce776cf7ac4936db71b0fedf3f0845771deb57dd))
* bound workflow call_api requests ([fb43e03](https://github.com/xlabtg/teleton-agent/commit/fb43e036994311bdb656c8b98986965d618345ea))
* bound workflow call_api requests ([29ae1ca](https://github.com/xlabtg/teleton-agent/commit/29ae1ca368e2f1a07f2b160c599b1f72bd620bef))
* **ci:** add pull_request trigger alongside pull_request_target to fix PR checks ([3bc28cb](https://github.com/xlabtg/teleton-agent/commit/3bc28cb67c577da4a04a0faf31dc74b4ce1787b6)), closes [#302](https://github.com/xlabtg/teleton-agent/issues/302)
* **ci:** add pull_request trigger to fix PR checks for same-repo branches ([f0dfe58](https://github.com/xlabtg/teleton-agent/commit/f0dfe586c485d243bea82247c39dcc73679b74d0))
* **ci:** resolve failing lint and test checks ([c8e26d7](https://github.com/xlabtg/teleton-agent/commit/c8e26d72b296e89429a897bbda67ab700c559915))
* **ci:** resolve TypeScript and lint errors introduced in sendTon refactor ([5171842](https://github.com/xlabtg/teleton-agent/commit/517184266450d62a27b62e8a0088a1de5a60a08e))
* **ci:** unblock TypeScript/Lint/Test on main + PR ([#304](https://github.com/xlabtg/teleton-agent/issues/304)) ([df82862](https://github.com/xlabtg/teleton-agent/commit/df82862bf84a31540982870dc4e34ead8ed3dced))
* **cli:** bind runtime home to explicit config ([3324154](https://github.com/xlabtg/teleton-agent/commit/332415439e033c5f9a1dd331efc64ac817559a1b))
* **cli:** bind runtime home to explicit config ([c5fc5da](https://github.com/xlabtg/teleton-agent/commit/c5fc5da5f9d40a22c3a37c7c9876df22cc528a17))
* **cli:** explain TELETON_HOME config override ([547e96f](https://github.com/xlabtg/teleton-agent/commit/547e96f24588b8d833df1dc7b59b7718be48bdeb))
* **cli:** explain TELETON_HOME config override ([6d926fc](https://github.com/xlabtg/teleton-agent/commit/6d926fca81401346e5ae9ddf3c36da98d732e818))
* **cli:** prevent secrets from appearing on argv and in shell history ([b50c466](https://github.com/xlabtg/teleton-agent/commit/b50c4665a90859b4f907c6833b36f8d5e3cc20fa))
* **cli:** prevent secrets from appearing on argv and in shell history [AUDIT-FULL-H7] ([705c4a3](https://github.com/xlabtg/teleton-agent/commit/705c4a37e4e758d300e8d66811d387f2c8ac2fcf))
* complete autonomous tasks from reflection success ([02df3ff](https://github.com/xlabtg/teleton-agent/commit/02df3ffddc3286700d42fa026ab5a174890a927b))
* **config:** throw on invalid/out-of-range port env vars ([e0d00b5](https://github.com/xlabtg/teleton-agent/commit/e0d00b5d5895215f5528c2cfa3467a3653d88a39))
* **config:** throw on invalid/out-of-range port env vars ([d7cb207](https://github.com/xlabtg/teleton-agent/commit/d7cb207a9d270a6b8c06a2e4e02710ea4ea65371)), closes [#317](https://github.com/xlabtg/teleton-agent/issues/317)
* dispatch agent network ingress tasks ([5ae9404](https://github.com/xlabtg/teleton-agent/commit/5ae940443b002edbc39217af30b4459657c727e8))
* dispatch network ingress tasks ([e63d129](https://github.com/xlabtg/teleton-agent/commit/e63d1292c1bdce519960226bb1f4fc903001eebe))
* **doctor:** checkWallet calls loadWallet() and returns ok/warn/error ([ddb87a9](https://github.com/xlabtg/teleton-agent/commit/ddb87a907e4a42d1250a215116b780e5a856a735))
* **doctor:** checkWallet calls loadWallet() and returns ok/warn/error ([c0212a7](https://github.com/xlabtg/teleton-agent/commit/c0212a75bfde3f08ac3053be405681f5d402666b))
* enable semantic memory route search ([8274917](https://github.com/xlabtg/teleton-agent/commit/82749174bebf113d0dad02bf85901f68b44f5622))
* enable semantic memory route search ([db22bcf](https://github.com/xlabtg/teleton-agent/commit/db22bcf16cb9b0620fe10fc5fb89bad4a8b3b2c2))
* enforce agent network ingress trust ([12bbd6f](https://github.com/xlabtg/teleton-agent/commit/12bbd6f83049241bf79675215b946e2ec16c4a0d))
* **exec:** replace prefix-match allowlist with token-based check and shell-free execution ([ad45996](https://github.com/xlabtg/teleton-agent/commit/ad459969a8e8d2059ab4dfde0a3cdc0ee1d2c52e))
* **exec:** replace prefix-match allowlist with token-based check and shell-free execution ([91096d0](https://github.com/xlabtg/teleton-agent/commit/91096d0b0e985a1ebe3bc07367ed20831a474570))
* expose v2 routes in management api ([8cb4082](https://github.com/xlabtg/teleton-agent/commit/8cb4082221b84a0a1d08a1e2b59e686522e36307))
* **formatting:** document implicit link-text escaping and add regression tests ([559f7c8](https://github.com/xlabtg/teleton-agent/commit/559f7c83f42abced1bed6ad6f07511fd0a8473f4))
* **formatting:** document implicit link-text escaping and add regression tests ([0babab6](https://github.com/xlabtg/teleton-agent/commit/0babab6b0c30c2dc198898a6b53cf846cca2e25f)), closes [#328](https://github.com/xlabtg/teleton-agent/issues/328)
* **heartbeat:** guard bridge availability before send and fix sentToTelegram TOCTOU ([1d25d73](https://github.com/xlabtg/teleton-agent/commit/1d25d7361af1f9261aec7cdc7e610887fdf727be))
* **heartbeat:** guard bridge availability before send and fix sentToTelegram TOCTOU ([2ffb742](https://github.com/xlabtg/teleton-agent/commit/2ffb742b5e6af9c614f1b95ec68eba7c4a6ea5e9))
* **hooks:** replace global hookDepth counter with AsyncLocalStorage for per-context reentrancy tracking ([da98cc0](https://github.com/xlabtg/teleton-agent/commit/da98cc03a07bd19bc77eccd371b017d66eeabfbd)), closes [#321](https://github.com/xlabtg/teleton-agent/issues/321)
* **hooks:** replace global hookDepth with AsyncLocalStorage for per-context reentrancy ([6ee7cf7](https://github.com/xlabtg/teleton-agent/commit/6ee7cf795131d035129ac604ee8d45afceb38bcd))
* **mcp:** reject tools with empty schema, namespace names, validate inputs ([6065389](https://github.com/xlabtg/teleton-agent/commit/60653894e1ab2e74147a23d16963ebe6f75dba82))
* **memory:** add circuit breaker to UpstashSemanticVectorStore to suppress log spam on repeated failures ([96d1442](https://github.com/xlabtg/teleton-agent/commit/96d1442ededbf0335772fb7250bf6b816498dea0))
* **memory:** circuit breaker for Upstash Vector search failures ([4b959a4](https://github.com/xlabtg/teleton-agent/commit/4b959a42cd3aea33265973ef7f75a6ac5ff518a5))
* **memory:** восстановить внешние ключи автономных задач ([2d5f502](https://github.com/xlabtg/teleton-agent/commit/2d5f5020f9743d8858fecd636e101db8ce7f2289))
* **mtproto:** fail over after getMe validation ([c1513d8](https://github.com/xlabtg/teleton-agent/commit/c1513d8e57268ebeb295a1a5ce8e566c4a91d5fb))
* **mtproto:** fail over after getMe validation ([0f053a4](https://github.com/xlabtg/teleton-agent/commit/0f053a4935c7d5274c85d458d8ae321a758c8a0c))
* **mtproto:** preserve proxy connection when getMe fails with auth error ([8cc2f50](https://github.com/xlabtg/teleton-agent/commit/8cc2f50496091abe84bb9cf060bab7a670ee16a0))
* **mtproto:** preserve proxy when getMe fails with auth error ([73b2233](https://github.com/xlabtg/teleton-agent/commit/73b22330e8fb98e074a1264a22c4d3de841eb780))
* **mtproto:** restore proxy auth recovery ([fd04def](https://github.com/xlabtg/teleton-agent/commit/fd04defa02803a6d5bcbcc02c6443e4338b4d422))
* **mtproto:** route auth and show proxy health ([3f5bec3](https://github.com/xlabtg/teleton-agent/commit/3f5bec38583472264e3097118e005ce4f81d86a9))
* **mtproto:** route setup auth through proxies ([5b6be7c](https://github.com/xlabtg/teleton-agent/commit/5b6be7c6fdf7881f8241cfb6d405848d145dbf02))
* **mtproto:** support fake TLS proxy secrets ([3d9147d](https://github.com/xlabtg/teleton-agent/commit/3d9147d29f771caaf9d1aa5716310edd13919cb8))
* **mtproto:** validate proxy status with session ([2246271](https://github.com/xlabtg/teleton-agent/commit/22462718e439533f83f3f633ebb9590bcc73169d))
* **mtproto:** validate proxy status with session ([61bec17](https://github.com/xlabtg/teleton-agent/commit/61bec175b5cfc696fbdad0f5dc6226e165c071ba))
* **network:** count local agent in network status totals ([b7cb0b7](https://github.com/xlabtg/teleton-agent/commit/b7cb0b7874c2cd3b4e81c1708a92db7b3febd47a))
* **network:** count the local agent in network status totals ([b49d8a4](https://github.com/xlabtg/teleton-agent/commit/b49d8a463055f7521827f6810201709d06157502))
* **network:** enforce ingress allowlist and recipient ([cb061b5](https://github.com/xlabtg/teleton-agent/commit/cb061b5b8600b565e96dfd41d90dd7047e897756))
* **network:** enforce ingress allowlist and recipient ([7330bd2](https://github.com/xlabtg/teleton-agent/commit/7330bd2ef10c2ce47bec9fc9b7d222f240aa1ed9))
* **network:** enforce ingress trust and recipient checks ([e5deafa](https://github.com/xlabtg/teleton-agent/commit/e5deafa28c5ea9d0b424445e6c3edebb8d8df05a))
* pass saved session to MTProto proxy checks ([b7e94f8](https://github.com/xlabtg/teleton-agent/commit/b7e94f80b652dd3b88044538805eb6720466f357))
* **pipeline:** bound steps by run timeout ([a824fec](https://github.com/xlabtg/teleton-agent/commit/a824fec45357d66808364344310593da9f19b797))
* **pipeline:** wait for delegated agent results ([0fb42cc](https://github.com/xlabtg/teleton-agent/commit/0fb42cc42d202a8efc4cf658483e956f7c9c4d83))
* **pipeline:** wait for delegated agent results ([f328032](https://github.com/xlabtg/teleton-agent/commit/f32803290bee8eb0c6028f53331a5d10e09654bc))
* **plugins:** add permission check, checksum verification, and production hot-reload guard (FULL-C1) ([9570416](https://github.com/xlabtg/teleton-agent/commit/9570416cfc644decbcaadb4271095425ec55c27d))
* **plugins:** permission check, checksum verification, production hot-reload guard (FULL-C1 [#306](https://github.com/xlabtg/teleton-agent/issues/306)) ([e5ac3d9](https://github.com/xlabtg/teleton-agent/commit/e5ac3d95f6261e7075067ae1223e5452933fe637))
* **plugins:** quiet checksum notices and resolve npm reliably ([329a83d](https://github.com/xlabtg/teleton-agent/commit/329a83d5cbc0c2c911160b441a6f8407500239b6))
* **plugins:** reduce startup noise and resolve npm reliably ([872b03a](https://github.com/xlabtg/teleton-agent/commit/872b03a87bc3eb490dd33b79a1557fe3ef469a31))
* reject replayed network messages ([6568a02](https://github.com/xlabtg/teleton-agent/commit/6568a02aaf477fd64eee0be834a432ea3f480e19))
* reject replayed network messages ([f4e742a](https://github.com/xlabtg/teleton-agent/commit/f4e742acdd27eff5c75587a18f4a695edabd0e58))
* **scheduler:** deduplicate cron workflow execution (AUDIT-M7) ([953c986](https://github.com/xlabtg/teleton-agent/commit/953c98660c5d2c5ad485e2888fbaf19802c4f4ca))
* **scheduler:** deduplicate cron workflow execution (AUDIT-M7) ([f4b8da1](https://github.com/xlabtg/teleton-agent/commit/f4b8da1b7efe1e5e47ef8af4c0f7b0b1cb905b09))
* **security:** detect leaf symlinks before realpath resolve; drop unused import ([0eaf318](https://github.com/xlabtg/teleton-agent/commit/0eaf318af07bce202327df69071da67d05052d2c))
* **security:** prevent SQL injection in ATTACH DATABASE via apostrophe in path ([8a4f73a](https://github.com/xlabtg/teleton-agent/commit/8a4f73a125361b76ba9745f2c599504c92435ba8)), closes [#324](https://github.com/xlabtg/teleton-agent/issues/324)
* **security:** prevent SQL injection via apostrophe in ATTACH DATABASE path (issue [#324](https://github.com/xlabtg/teleton-agent/issues/324)) ([b86d18a](https://github.com/xlabtg/teleton-agent/commit/b86d18a3582e94484c3d6ea30c48435056ed2b8e))
* **security:** remove admin_ids from plugin sanitized config, add isAdmin() SDK capability ([ef687b9](https://github.com/xlabtg/teleton-agent/commit/ef687b965d4fe5af6918f208893c101c742f7c80))
* **security:** remove admin_ids leak from plugin sanitized config, add sdk.isAdmin() ([e63a44f](https://github.com/xlabtg/teleton-agent/commit/e63a44f47d154630c24d5fc18312351ebbd34f94))
* **security:** resolve 14 npm vulnerabilities and raise audit threshold ([abe66f1](https://github.com/xlabtg/teleton-agent/commit/abe66f1d0ba4c702b0157c22eec4fa79b2391208)), closes [#329](https://github.com/xlabtg/teleton-agent/issues/329)
* **security:** resolve 14 npm vulnerabilities and raise audit threshold to high ([8def302](https://github.com/xlabtg/teleton-agent/commit/8def302d42f77d6c5454d2072762d549e198676d))
* **security:** resolve parent-dir symlinks and add O_NOFOLLOW writes (FULL-M3) ([d1db814](https://github.com/xlabtg/teleton-agent/commit/d1db8140d26a4f9371cb5bd5f1efb71395a4c7e9)), closes [#323](https://github.com/xlabtg/teleton-agent/issues/323)
* **security:** resolve parent-dir symlinks and use O_NOFOLLOW writes (FULL-M3 [#323](https://github.com/xlabtg/teleton-agent/issues/323)) ([21342de](https://github.com/xlabtg/teleton-agent/commit/21342deba5b42991d541f8988d944de092098a32))
* **security:** sanitize task description before Saved Messages post; guard JSON.parse in executor ([97ae860](https://github.com/xlabtg/teleton-agent/commit/97ae8605999f7319d07256ec06912ff9bae79619))
* **security:** sanitize task description before Saved Messages post; guard JSON.parse in executor ([05e980a](https://github.com/xlabtg/teleton-agent/commit/05e980a520ed28835a9dc2513a970c807b429f5d))
* **security:** sanitize upstream error bodies and fix 401 false-positive refresh ([b8a279e](https://github.com/xlabtg/teleton-agent/commit/b8a279e91c1e1388e76f137c9271c5b5b279da1a))
* **security:** sanitize upstream error bodies and fix 401 substring-match ([e5eb7cf](https://github.com/xlabtg/teleton-agent/commit/e5eb7cf6b64224bda75fcc13bb8956a440ba644b)), closes [#320](https://github.com/xlabtg/teleton-agent/issues/320)
* **security:** обновить override axios до &gt;=1.16.1 для устранения high-уязвимости ([3bcf55e](https://github.com/xlabtg/teleton-agent/commit/3bcf55ea988a8af110ac4ddb064cbbc5cb323590))
* send csrf token for agent controls ([69f2f2a](https://github.com/xlabtg/teleton-agent/commit/69f2f2a12bca279e3e42042700c12f75ccef7721))
* send CSRF token for agent controls ([be7dff9](https://github.com/xlabtg/teleton-agent/commit/be7dff9469df30ec2e4bd2dbbbb2218b57b165eb))
* **session:** cap transcripts at 5k messages and replace cache with LRU ([062ebc0](https://github.com/xlabtg/teleton-agent/commit/062ebc083c18609a217fba1a3524a3cf7a49ac4b))
* **session:** cap transcripts at 5k messages and replace cache with LRU [AUDIT-FULL-M5] ([5ffeaf9](https://github.com/xlabtg/teleton-agent/commit/5ffeaf905b10bcd878dcff65cdf3d47c4ad4257a))
* **setup:** allow QR auth before config save ([1b887ee](https://github.com/xlabtg/teleton-agent/commit/1b887eebc8ada265929cfef0bae382195f33ade8))
* **setup:** allow QR auth before config save ([f1b9495](https://github.com/xlabtg/teleton-agent/commit/f1b94956e24fa7de665b454a773cb754cdd282f2))
* **sse:** detach stateChange listener immediately on client disconnect ([bb31e22](https://github.com/xlabtg/teleton-agent/commit/bb31e229bf6d05e50ff0b2a6ffd59bd79be314e9))
* **sse:** detach stateChange listener immediately on client disconnect ([dc030c9](https://github.com/xlabtg/teleton-agent/commit/dc030c9b802a424ed46619e228252394d3e7b773)), closes [#326](https://github.com/xlabtg/teleton-agent/issues/326)
* **tasks:** execute Saved Messages scheduled task triggers ([39ef5a8](https://github.com/xlabtg/teleton-agent/commit/39ef5a81cfeba77bddff8db98eb2cacdefa52309))
* **tasks:** execute saved messages task triggers ([32b4925](https://github.com/xlabtg/teleton-agent/commit/32b492547fc5bccb8b90cc31a23c7f0fb4a6ba61))
* **telegram:** preserve MTProxy metadata on reconnect ([4dbc0cf](https://github.com/xlabtg/teleton-agent/commit/4dbc0cf45235b7c13e6990ff672d215342658c1d))
* **ton:** replace pseudo-hash with real on-chain tx hash in sendTon ([3e4baaf](https://github.com/xlabtg/teleton-agent/commit/3e4baaf102c91f3c5139dc74130c0c86ae933c76))
* **ton:** replace pseudo-hash with real on-chain tx hash in sendTon ([fe40d5c](https://github.com/xlabtg/teleton-agent/commit/fe40d5ca6549823021c6ec5d4de40c4de650d48e))
* validate MTProto proxy status with saved session ([dae5a7f](https://github.com/xlabtg/teleton-agent/commit/dae5a7fc4c2996fa79894db4d55eedf012106885))
* **wallet:** zeroize secretKey on /pause and SIGTERM (AUDIT-FULL-L3 [#319](https://github.com/xlabtg/teleton-agent/issues/319)) ([37de003](https://github.com/xlabtg/teleton-agent/commit/37de003db18b2977904409180ef1cf9cd34e8e98))
* **wallet:** zeroize secretKey on /pause and SIGTERM (AUDIT-FULL-L3) ([feacd57](https://github.com/xlabtg/teleton-agent/commit/feacd575b9c17c537947e9c63eea1edd4f9259a7)), closes [#319](https://github.com/xlabtg/teleton-agent/issues/319)
* **webui:** make hashed startup login link usable ([7d433a2](https://github.com/xlabtg/teleton-agent/commit/7d433a29afaccdf188960d131b67264bdc1ced97))
* **webui:** make hashed startup login link usable ([90294ea](https://github.com/xlabtg/teleton-agent/commit/90294ead65fec470805c25c21b8ce370e2561119))
* **windows:** allow default TELETON_HOME backslashes ([6e59032](https://github.com/xlabtg/teleton-agent/commit/6e59032195c55f0227fb804a59d919ae9af6804f))
* **windows:** allow plugin loading on NTFS paths ([38a9c37](https://github.com/xlabtg/teleton-agent/commit/38a9c37c76b57c6ee48f86be73a836ab6401fd93))
* **windows:** skip POSIX plugin mode check ([8ae4415](https://github.com/xlabtg/teleton-agent/commit/8ae44155a5a68365e571d20150e0d1e73f5fb44e))
* исправить внешние ключи автономных задач ([103fb1b](https://github.com/xlabtg/teleton-agent/commit/103fb1b14311f0e231868e3a4c0aefae9d83d0eb))
* регенерировать docs/api-reference после добавления маршрута /metrics ([c49e9e0](https://github.com/xlabtg/teleton-agent/commit/c49e9e0a99b62a5df71bc07165c4e324b6f6f414))


### Reverts

* Remove .gitkeep changes from initial commit ([9be2388](https://github.com/xlabtg/teleton-agent/commit/9be2388ed6bc61b3bec4d6c50f1913a8cc0a0ce6))
* Remove .gitkeep changes from initial commit ([18c4bfc](https://github.com/xlabtg/teleton-agent/commit/18c4bfc108b09ec8f8788dcf602d2b7c94b99848))
* Remove .gitkeep changes from initial commit ([7a54f9a](https://github.com/xlabtg/teleton-agent/commit/7a54f9a846c86b316b2e9e41552ae32f43a9afe6))
* Remove .gitkeep changes from initial commit ([2cb2923](https://github.com/xlabtg/teleton-agent/commit/2cb292344dc8f2a205497b9779a6258d5617ce32))
* Remove .gitkeep changes from initial commit ([8c96c69](https://github.com/xlabtg/teleton-agent/commit/8c96c69705607584b2824ac4f84e3c1ff234523d))
* Remove .gitkeep changes from initial commit ([5382492](https://github.com/xlabtg/teleton-agent/commit/5382492dcb4efc7866b1bb096db23618dfb10957))
* Remove .gitkeep changes from initial commit ([42d2034](https://github.com/xlabtg/teleton-agent/commit/42d2034a7bdb2a3b581c3c92fdd71fa8ab0567ca))
* Remove .gitkeep changes from initial commit ([9582ab3](https://github.com/xlabtg/teleton-agent/commit/9582ab3dc537ddc53f78256b21c20ee1010d5fb2))


### Documentation

* add bilingual WebUI user guide ([66c42e3](https://github.com/xlabtg/teleton-agent/commit/66c42e3e0a214fd9cebf2979591d1a3585fd582b))
* add bilingual WebUI user guide ([1b6a3b2](https://github.com/xlabtg/teleton-agent/commit/1b6a3b24128104186b63ca690bd22ea3372c815e))
* add feedback dashboard screenshot ([2b88415](https://github.com/xlabtg/teleton-agent/commit/2b8841540611ede23f34cb458f02f98f790d2cd5))
* add self-correction monitoring screenshot ([63c8e59](https://github.com/xlabtg/teleton-agent/commit/63c8e59bd0c5c4dac353ba9c4810c93e018aa2f1))
* **api:** ссылки на OpenAPI-референс, тесты спеки и bump до 0.8.20 ([606bf16](https://github.com/xlabtg/teleton-agent/commit/606bf169f42d57e698320fa2a4dd17277f5d0eb8))
* **audit:** add FULL_AUDIT_REPORT.md — full-repo audit for v3.0 ([6b51a9f](https://github.com/xlabtg/teleton-agent/commit/6b51a9fe09cfe2a5962bcad74a7bbcc1f54fcf2b))
* **audit:** add full-audit work report for v3.0 (issue [#354](https://github.com/xlabtg/teleton-agent/issues/354)) ([10b39d6](https://github.com/xlabtg/teleton-agent/commit/10b39d6ca799b5a7bc3625a5e33ba8a3962d3f71))
* **audit:** add full-audit work report for v3.0 (issue [#354](https://github.com/xlabtg/teleton-agent/issues/354)) ([ee9afde](https://github.com/xlabtg/teleton-agent/commit/ee9afde3195fb5e2bb15b137f780994c9de6765b))
* **audit:** add improvements/work2/ — ready-to-file issue templates for full-repo audit ([3229ade](https://github.com/xlabtg/teleton-agent/commit/3229ade25838205174f3b244910f0fd8d8531165))
* **audit:** add post-audit work report — summary of all 23 findings and fixes ([#300](https://github.com/xlabtg/teleton-agent/issues/300)) ([dbe9711](https://github.com/xlabtg/teleton-agent/commit/dbe971101fb08616a89014edfdb7247a50052f7d))
* **audit:** add post-audit work report with links to all 23 findings and fixes ([97210ad](https://github.com/xlabtg/teleton-agent/commit/97210ad7b2d40f7c3afa67a9ffa268061c056fba))
* **audit:** add V2 work3 audit and follow-up issues ([fea2642](https://github.com/xlabtg/teleton-agent/commit/fea264239089a7517064a9aeece055f347d8a821))
* **audit:** add V2 work3 audit report ([ea6b996](https://github.com/xlabtg/teleton-agent/commit/ea6b99602efb80e978063d3d02e2afef2ad36ec7))
* **audit:** add V2 work3 hardening reports ([c7f69ea](https://github.com/xlabtg/teleton-agent/commit/c7f69ea79f39f4f3e96725644b5fe2a04c890483))
* **audit:** add work3 V2 hardening report ([ae0f8ea](https://github.com/xlabtg/teleton-agent/commit/ae0f8ea5e0663e2e60670b4772167360d4623b02))
* **audit:** full-repo audit FULL_AUDIT_REPORT.md for v3.0 ([7e197b7](https://github.com/xlabtg/teleton-agent/commit/7e197b7410af79b3413b9b808927f2da0de371bf))
* **audit:** link filed V2 follow-up issues ([69d64b0](https://github.com/xlabtg/teleton-agent/commit/69d64b0343edefb0823a3519cd497818c295014d))
* **audit:** move FULL_AUDIT_REPORT.md back to repo root ([d0e918e](https://github.com/xlabtg/teleton-agent/commit/d0e918e4fe297c2327aac009b0b8c748625cba09))
* **changelog:** задокументировать E2E-набор WebUI ([8240303](https://github.com/xlabtg/teleton-agent/commit/82403031ff6cf8d58e3f3864aca4bd3ae0cfd2c7))
* document SemVer policy, commit conventions, and automated releases ([31efff5](https://github.com/xlabtg/teleton-agent/commit/31efff54c9eca83fedf13db17361a9a8531123e7))
* **network:** add before/after screenshots for issue 471 ([8353e0f](https://github.com/xlabtg/teleton-agent/commit/8353e0f65cfcfcf375644bc5a79741768b328b56))
* **readiness:** добавить анализ готовности продукта и SEO-ассеты ([48d0aa9](https://github.com/xlabtg/teleton-agent/commit/48d0aa9df840d257d7c0959f392c5df0bb0fb388)), closes [#487](https://github.com/xlabtg/teleton-agent/issues/487)
* **readiness:** добавить ссылки на созданные issue (R1–R14) ([d2fa0fa](https://github.com/xlabtg/teleton-agent/commit/d2fa0fa462c8024762abfc31fb788a72fff11f63)), closes [#487](https://github.com/xlabtg/teleton-agent/issues/487)
* **readiness:** обновить ссылки на issue — перенести в upstream xlabtg/teleton-agent ([c46264d](https://github.com/xlabtg/teleton-agent/commit/c46264d257adc5c57805a3fc0cbe15b8b8587b8f))
* **readme:** align README with implemented features and upstream ([9f8aeee](https://github.com/xlabtg/teleton-agent/commit/9f8aeee232ac9e4951f36735a423d852653bcab9))
* **readme:** align README with implemented features and upstream ([cd59b76](https://github.com/xlabtg/teleton-agent/commit/cd59b76f4e8de6fe2dbd97d50ed40265e96c4502))
* **readme:** синхронизировать строку версии с bump 0.8.20 ([b862ee6](https://github.com/xlabtg/teleton-agent/commit/b862ee641bd38fe844aa3a812dbf8dec091ab577))
* **readme:** уточнить описание ffmpeg-free voice notes и Groq TTS WAV fix ([824b52f](https://github.com/xlabtg/teleton-agent/commit/824b52f33e2ec4795f126e53717dfefe01802ce9))
* rewrite WebUI guide README, quick-start, dashboard, autonomous, tools, soul (EN+RU) ([7686c62](https://github.com/xlabtg/teleton-agent/commit/7686c62bcea3ad22cfbd3a0212ce0903d930c58e))
* rewrite WebUI user guide for accuracy and bilingual parity ([64c95b4](https://github.com/xlabtg/teleton-agent/commit/64c95b4919209180329e357fb89adf0754c4f142))
* **user-guide:** rewrite analytics, sessions, security, hooks, advanced, settings, troubleshooting, FAQ + relocate fresh login/setup screenshots ([968cf78](https://github.com/xlabtg/teleton-agent/commit/968cf789908f7260b0b416382b31f271e814ab25))
* актуализировать README форка ([e02dd57](https://github.com/xlabtg/teleton-agent/commit/e02dd57463b94b267881557ffe9ce0886c8c9679))


### Build System

* **commitlint:** enforce Conventional Commits via husky commit-msg hook ([3419254](https://github.com/xlabtg/teleton-agent/commit/341925452f46b32c7c28078e7306e8beabd2dff5))
* **openapi:** статические артефакты, redocly lint и CI-проверка ([29de222](https://github.com/xlabtg/teleton-agent/commit/29de222fe05eb70136239d87f751f512748ddea3))

## [Unreleased]

### Added
- **Deployment artifacts (Docker Compose + Helm chart)**: A ready-to-use `compose.yaml` (with `.env.example`) at the repo root brings up the agent with a persistent `teleton-data` volume, `unless-stopped` restart policy, and a Node-based `/health` healthcheck via `docker compose up`. A minimal Helm chart in `helm/teleton-agent/` renders a single-replica `Deployment` (`Recreate`), `Service`, `PersistentVolumeClaim`, and optional credentials `Secret` with `/health` liveness/readiness probes. The release workflow now builds a multi-arch image (`linux/amd64`, `linux/arm64`) via QEMU/Buildx, attaches provenance + SBOM, and signs it keylessly with cosign. `docs/deployment.md` and the README document the Compose and Kubernetes/Helm quick-starts, and a new CI job validates the Compose file and Helm chart (closes xlabtg/teleton-agent#498).

### Deprecated
- **`telegram_schedule_message` agent tool**: Now logs a runtime deprecation warning and surfaces `deprecated: true` plus a `deprecationNotice` field in its result. The tool only queues plain text and cannot execute tools, trading functions, or multi-step workflows when the message is delivered, which silently breaks any automation that relies on it. Use `telegram_create_scheduled_task` (with a `tool_call` or `agent_task` payload) for any automation that must run at a scheduled time. The tool description now leads with `[DEPRECATED — use telegram_create_scheduled_task instead]` so the LLM picks the correct tool by default (closes xlabtg/teleton-agent#459).

### Added
- **Backup / restore / migration-rollback tooling**: New `teleton backup` and `teleton restore` CLI commands (plus `npm run backup` / `npm run restore` and `bin/backup.sh` / `bin/restore.sh` wrappers) create and restore a timestamped, integrity-verified `teleton-backup-YYYY-MM-DD-HHMMSS.tar.gz` of all critical data under `TELETON_HOME` — wallet, SQLite databases (captured via consistent `serialize()` snapshots + `integrity_check`, safe to run while the agent is live), sessions, config, and workspace. Each archive carries a `manifest.json` with per-file SHA-256 checksums plus app and schema versions; restore verifies every checksum, refuses to overwrite onto a newer schema unless `--force`, and writes a safety backup of the current state before overwriting. A pre-upgrade hook auto-creates a backup on the first start after a schema-version bump and aborts the migration if the backup fails (never migrate without a recoverable backup). The native, dependency-free POSIX-ustar + gzip archive is readable by system `tar`. Documented in `docs/backup-restore.md` with manual, cron, and systemd procedures and an upgrade-with-rollback runbook (closes xlabtg/teleton-agent#497).
- **End-to-end WebUI test suite (Playwright)**: New `e2e/` directory with 8 Playwright smoke tests covering the critical WebUI flows — setup wizard completion, dashboard agent-status load, task create/cancel, memory search, pipeline create-and-save, security settings persistence across reload, and the unauthenticated→login redirect. Tests run against the built static frontend (`npm run build:web`) with a deterministic, credential-free network-mock backend (`e2e/fixtures/mock-backend.ts`), so they need no live Telegram/LLM secrets. Added `playwright.config.ts`, an `npm run test:e2e` script, and a CI workflow (`.github/workflows/e2e.yml`) gated behind the `RUN_E2E` repo variable with fork protection and screenshot/report artifact upload on failure (closes xlabtg/teleton-agent#496).
- **Bot API HTTPS proxy (`mtproto.bot_api_proxy`)**: Optional HTTP/HTTPS or SOCKS5 proxy URL for Telegram Bot API HTTPS calls to `api.telegram.org`. MTProto proxies cannot tunnel HTTPS, so this lets the deals bot reach the Bot API in regions where Telegram is also blocked at the IP level. Wired through to Grammy's `client.baseFetchConfig.agent` via `https-proxy-agent` / `socks-proxy-agent` (closes xlabtg/teleton-agent#439).

### Fixed
- **Spurious `[Bot] Polling error: Aborted delay` on Ctrl+C**: `DealBot.start()` no longer logs the polling promise rejection that Grammy raises when `bot.stop()` aborts the in-flight long-poll delay. Stopping the agent (especially with the MTProxy path active) is now silent on the polling channel, while real polling failures during normal operation continue to be logged (closes xlabtg/teleton-agent#460).
- **WorkflowScheduler cron deduplication (AUDIT-M7)**: `tick()` now tracks `runningWorkflowIds` (in-memory `Set`) to skip workflows whose previous execution is still in progress, and persists `last_fired_bucket` (`floor(ms/60000)`) to the DB so the same minute bucket never fires twice — even after a process restart. DB migration 1.26.0 adds the `last_fired_bucket` column to `workflows` (closes xlabtg/teleton-agent#327).

### Changed
- **Autonomous TON spending defaults tightened (AUDIT-M3)**: `DEFAULT_POLICY_CONFIG.tonSpending` reduced by 10× (`perTask` 1 → 0.1 TON, `daily` 5 → 0.5 TON, `requireConfirmationAbove` 0.5 → 0.05 TON) to limit financial exposure for users who run the agent with a linked wallet and do not customise the policy config. Users who relied on the previous permissive defaults must explicitly raise the limits in their `config.yaml` under the `autonomous.policy.ton_spending` key (closes xlabtg/teleton-agent#286).

### Added
- **Prediction engine**: Behavior event tracking, Markov-style next-action predictions, topic-to-tool suggestions, WebUI prediction APIs, and dashboard suggestions with feedback.
- **`web_download_binary` tool**: Download public HTTP(S) binary files into workspace `downloads/` with MIME validation, a 10 MB size cap, redirect support, and optional request headers for authorized URLs.
- **Upstash Vector setup guide** (`docs/upstash-vector-setup.md`): Step-by-step walk-through for provisioning the Upstash index with the dimension the embedding provider produces, connecting Teleton through the WebUI / `config.yaml` / environment variables, verifying the health-check log, and recovering from a dimension mismatch. Referenced from the README, `GETTING_STARTED.md`, `docs/configuration.md`, and `docs/semantic-memory.md` (closes xlabtg/teleton-agent#248).

### Fixed
- **Autonomous task escalations reach the user** (AUDIT-H2): `notify()` in `src/autonomous/integration.ts` now pushes a Telegram DM to every admin via `deps.bridge.sendMessage`, records an in-app warning in the `notifications` table, and emits `escalation` / `update` events on `notificationBus` for real-time WebUI badges. Delivery failures are caught per channel so `log.warn` remains the last-resort fallback (closes xlabtg/teleton-agent#262).
- **Vector memory sync**: Detect Upstash Vector index/embedding dimension mismatches before upsert, surface the configured index dimension in semantic memory status and sync responses, and log an actionable warning at startup (closes xlabtg/teleton-agent#246).
- **Autonomous policy bypass via pause/resume (AUDIT-C3)**: `AutonomousLoop` now persists and hydrates `PolicyEngine` state (rate-limit sliding windows, loop-detection recent actions, uncertainty counter) through a new `policy_state` table so that scripted `pauseTask()` + `resumeTask()` cycles can no longer reset the 100 tool-calls-per-hour limit or the 5-identical-actions loop detector. Adds migration 1.23.0 and regression tests covering 10 pause/resume cycles (closes xlabtg/teleton-agent#256).

## [0.8.1] - 2026-03-05

### Added
- **TON Proxy module**: Built-in Tonutils-Proxy lifecycle manager — auto-download binary from GitHub, start/stop, health checks, auto-restart on crash, PID-based orphan cleanup, WebUI API routes for hot-toggle
- **SDK signed transfers**: `createTransfer()`, `createJettonTransfer()`, `getPublicKey()`, `getWalletVersion()` — sign TON/jetton transfers without broadcasting for x402 payment protocol
- **Plugin hooks system**: 13 typed hooks via `sdk.on()` — `message:receive`, `response:before/after/error`, `tool:error`, `prompt:after`, `agent:start/stop`, plus 5 original lifecycle hooks with configurable priority
- **User-configurable hooks**: Keyword blocklist and context triggers for automated responses
- **QR code login**: WebUI setup wizard supports QR code authentication as alternative to phone+code
- **Two-phase observation masking**: Old tool results fully masked, previous iteration results truncated at 4K while preserving summary fields, current iteration intact

### Changed
- **WebUI Config page**: Reorganized into dedicated tabs (Agent, Telegram, TON Proxy, Sessions, Tool RAG)
- **RAG performance**: Knowledge + feed hybrid searches run concurrently via `Promise.all` (~200-500ms saved per message); parsed transcripts cached in memory with invalidation on delete/archive
- **15 LLM providers**: Documentation updated across all `.md` files to reflect Cerebras, ZAI, MiniMax, Hugging Face additions
- **70+ models** in shared catalog (up from 60+)

### Fixed
- **Tool RAG scoring**: Keyword search scores normalized to 1.0 weight when no embedding provider is configured (was incorrectly using 0.4)
- **Transcript deduplication**: `loadContextFromTranscript()` deduplicates `toolResult` messages by `toolCallId`, preventing API 400 errors on corrupted transcripts
- **TON Proxy orphan process**: Manager now writes PID file and checks port occupancy before start, killing orphan processes from previous sessions
- **Security**: Sanitize hook context, fix `effectiveIsGroup` self-reference crash (TDZ)
- **CI**: Coverage thresholds lowered with margin for Node 20 CI variance
- **ESLint**: Strict config with quality tooling and CI hardening

## [0.8.0] - 2026-03-02

### Added
- **4 new LLM providers** (11 → 15): Cerebras (ultra-fast inference, free tier), ZAI/Zhipu (2 free models), MiniMax (M2.5, 204K ctx), Hugging Face (routing to 18 models via single token)
- **Bot SDK for plugins**: `sdk.bot` with inline query handling, callback routing, colored/styled buttons (success/danger/primary), lazy-loaded, rate-limited, namespace-isolated per plugin
- **29 new SDK methods**: Full Telegram surface (77 tools), TON jetton analytics, dual DEX aggregator, .ton DNS management, scheduled messages, Stars/gift marketplace, `getDialogs`/`getHistory`, `kickUser`
- **`dns.setSiteRecord()`**: Set ADNL records on .ton domains for TON Site hosting
- **GramJS Layer 223**: Participant ranks and message `from_rank` surfaced in agent display

### Changed
- **Moonshot provider**: Refactored from hardcoded model dict to pi-ai native `kimi-coding` provider (30 lines removed). Backward-compat alias maps `kimi-k2.5` → `k2p5`
- **Configurable keys**: Provider list derived from `getSupportedProviders()` instead of hardcoded copy

### Fixed
- **Docker build**: Remove deleted `scripts/` references from Dockerfile; skip husky prepare in runtime stage
- **Release workflow**: Publish-npm and create-release skip gracefully when version already published (idempotent re-push)
- **Security**: NFKC normalization + Unicode Tag Block filtering, SQL comment stripping on plugin DB proxy, download size guard (50MB), deep-clone frozenConfig
- **Performance**: Single shared embedding for context + tool RAG, edges-first chunk reordering, feed truncation (2000 chars)
- **UTC session reset**, transcript permissions, masked API key display

## [0.7.5] - 2026-02-28

### Added
- **YOLO Mode** (Coding Agent): 4 new exec tools for full system access on Linux — `exec_run` (bash commands), `exec_install` (apt/pip/npm/docker), `exec_service` (systemd management), `exec_status` (server health). Disabled by default (`mode: off`), requires explicit `mode: yolo` opt-in. Admin-only scope, configurable timeout (120s), output limit (50KB), full audit trail in SQLite
- **`admin-only` access policy**: New DM and group policy option — only Telegram admins can interact with the agent. Now the default for new installations (previously `open`)
- **DNS set-site tool**: `dns_set_site` links a `.ton` domain to a TON Site via ADNL address for decentralized website hosting
- **GramJS Layer 222 fork**: Switch from npm `telegram` to TONresistor/gramjs fork — native Layer 222 constructors, no more TL schema patching
- **4 NFT marketplace tools** (73 → 77): `get-unique-gift`, `get-unique-gift-value`, `send-gift-offer`, `resolve-gift-offer`
- **Gift service messages**: Real-time handling of gift offers received/declined and gifts received — agent can react automatically
- **TON balance query**: `telegram_get_stars_balance` now supports `ton=true` for internal TON ledger balance
- **Live token usage tracking**: WebUI dashboard displays real-time token consumption with cache hit rates
- **Channel username tools** (70 → 73): `check-channel-username`, `set-channel-username`, `create-channel-username`
- **Toncenter API key**: Centralized TonClient caching with optional Toncenter API key for higher rate limits
- **DB migration 1.12.0**: `exec_audit` table for command execution history (indexed by timestamp, user)
- **DB migration 1.13.0**: Per-session token usage tracking (input/output tokens accumulated per chat)
- **Session auto-pruning**: Sessions older than 30 days are automatically cleaned up at startup

### Changed
- **Tool RAG enabled by default**: Semantic tool selection now active for all providers, reducing ~120 tools to ~25 per LLM call
- **35+ tool descriptions enriched**: Cross-references and clearer context for better RAG matching accuracy
- **Default access policy**: DM and group policies default to `admin-only` instead of `open` — secure by default
- **CLI wizard**: New "Coding Agent" setup question, policy choices reordered (Admin Only first)
- **WebUI wizard**: New "System Execution" select with YOLO mode + VPS warning
- **Dashboard**: Policy selects updated with `admin-only` option and clearer labels
- **Gift catalog rework**: `get-available-gifts` now supports pagination, sorting (price, resale count), search by title, and resale filter
- **Resale identifiers**: `buy-resale-gift` migrated from `odayId` to `slug`, `set-collectible-price` from `odayId` to `msgId`
- **Resale error handling**: `STARGIFT_RESELL_TOO_EARLY` parsed with human-readable wait time, `STARGIFT_INVALID` with guidance
- **Styled keyboard**: Native Layer 222 constructors for `KeyboardButtonStyle`, `KeyboardButtonCopy`, `KeyboardButtonCallback` — no more `(Api as any)` casts
- **WebUI dashboard**: Redesigned with provider switch, tools & plugins panels
- **WebUI config page**: Harmonized UX across all settings panels
- **Ston.fi DEX**: Migrated to SDK v2 with hardened SendMode and transaction locking

### Fixed
- **Typing indicator**: Persistent typing during agent processing with retry and dedup hardening
- **Auth flow**: Guard `SentCodePaymentRequired` type (Layer 222 narrowing) in both CLI and WebUI auth
- **send-gift**: Use `getInputEntity()` instead of `getEntity()` for correct InputPeer type

### Removed
- **Postinstall patch system**: `scripts/patch-gramjs.sh` and `scripts/postinstall.mjs` — no longer needed with Layer 222 fork

## [0.7.4] - 2026-02-25

### Added
- **Configurable keys overhaul**: Array type support (admin_ids, allow_from, group_allow_from), labels and option labels on all keys, new keys for Telegram rate limits, Deals params, Embedding model, Cocoon port, Agent base_url
- **ArrayInput component**: Tag-style input for managing array config values in the dashboard
- **Memory sources browser**: List indexed knowledge sources with entry counts, expand to view individual chunks with line ranges
- **Workspace image preview**: Serve raw images with correct MIME type, 5MB limit, SVG sandboxing
- **Tool RAG persistence**: RAG config (enabled, topK, alwaysInclude, skipUnlimitedProviders) now persists to YAML
- **Tasks bulk clean**: Clean tasks by terminal status (done, failed, cancelled) instead of just done
- **GramJS bot session persistence**: Save/load MTProto session string to avoid re-auth on restart

### Changed
- **Remove "pairing" DM policy**: Simplified to open/allowlist/disabled — pairing was unused
- Dashboard Config page reorganized with Telegram settings section, Cocoon port panel, extended Tool RAG controls
- Setup wizard flow reordered, wallet and modules steps cleaned up
- Dashboard and Config pages restructured for better UX
- Soul editor textarea fills available height

### Fixed
- Select dropdown renders via portal (z-index stacking fix)
- Model selection moved into Provider step (no longer separate Config step)
- Async log pollution during CLI setup suppressed
- Telegram commit notification extra blank lines removed
- owner_id auto-syncs to admin_ids on save

## [0.7.3] - 2026-02-24

### Added
- **Claude Code provider**: Auto-detect OAuth tokens from local Claude Code installation (~/.claude/.credentials.json on Linux/Windows, macOS Keychain) with intelligent caching and 401 retry
- **Reply-to context**: Inject quoted message context into LLM prompt when user replies to a message
- **Fragment auth**: Support Telegram anonymous numbers (+888) via Fragment.com verification
- **7 new Telegram tools** (66 → 73): transcribe-audio, get/delete-scheduled-messages, send-scheduled-now, get-collectible-info, get-admined-channels, set-personal-channel
- **Voice auto-transcription**: Automatic transcription of voice/audio messages in handler
- **Gated provider switch**: Dashboard provider change requires API key validation before applying
- **Shared model catalog**: 60+ models across 11 providers, extracted to `model-catalog.ts` (eliminates ~220 duplicated lines)

### Fixed
- **TEP-74 encoding**: Correct jetton transfer payload encoding and infrastructure robustness
- Replace deprecated `claude-3-5-haiku` with `claude-haiku-4-5`
- Seed phrase display in CLI setup
- Bump pi-ai 0.52 → 0.54, hono 4.11.9 → 4.12.2, ajv 8.17.1 → 8.18.0

## [0.7.2] - 2026-02-23

### Fixed
- **Plugins route**: WebUI now reflects runtime-loaded plugins instead of static config

## [0.7.1] - 2026-02-23

### Added
- **Agent Run/Stop control**: Separate agent lifecycle from WebUI — start/stop the agent at runtime without killing the server. New `AgentLifecycle` state machine (`stopped/starting/running/stopping`), REST endpoints (`POST /api/agent/start`, `/stop`, `GET /api/agent/status`), SSE endpoint (`GET /api/agent/events`) for real-time state push, `useAgentStatus` hook (SSE + polling fallback), and `AgentControl` sidebar component with confirmation dialog
- **MCP Streamable HTTP transport**: `StreamableHTTPClientTransport` as primary transport for URL-based MCP servers, with automatic fallback to `SSEClientTransport` on failure. `mcpServers` list is now a lazy function for live status. Resource cleanup (AbortController, sockets) on fallback. Improved error logging with stack traces

### Fixed
- **WebUI setup wizard**: Neutralize color accent overuse — selection states, warning cards, tag pills, step dots all moved to neutral white/grey palette; security notice collapsed into `<details>`; "Optional Integrations" renamed to "Optional API Keys"; bot token marked as "(recommended)"
- **Jetton send**: Wrap entire `sendJetton` flow in try/catch for consistent `PluginSDKError` propagation; remove `SendMode.IGNORE_ERRORS` (errors are no longer silently swallowed); fix `||` → `??` on jetton decimals (prevents `0` decimals being replaced by `9`)

## [0.7.0] - 2026-02-21

### Added
- **WebUI Setup Wizard**: 6-step guided onboarding flow (Welcome, Provider, Telegram, Config, Wallet, Connect) with shared Shell sidebar layout, React context state management, server-side validation mirror, and "Start Agent" button with seamless setup-to-dashboard transition
- **Local LLM Provider**: New "local" provider for OpenAI-compatible servers (Ollama, vLLM, LM Studio, llama.cpp) with auto-model discovery from `/models` endpoint, CLI `--base-url` option, and WebUI provider card
- `getEffectiveApiKey()` helper for consistent API key resolution across all LLM call sites
- ASCII banner for `teleton setup --ui` matching `teleton start`
- 86 setup route tests + 39 validation tests (898 total tests)

### Fixed
- **Security audit remediation (27 fixes)**: MCP env var blocklist, sendStory symlink-safe path validation (realpathSync), DB ATTACH/DETACH proxy for plugin isolation, BigInt float precision (string-based decimals), debounce clamp, SendMode.IGNORE_ERRORS removed, URL quote escaping, wallet JSON validation, pino redact, and more
- `fetchWithTimeout` (10s) + http/https scheme validation on local model discovery
- Model array capped to 500 entries to prevent unbounded growth
- Early exit when provider=local but `base_url` missing
- Non-interactive onboarding: relaxed `--api-key` for local/cocoon providers
- WebUI UX: CSS specificity fixes, bot token inline field, wallet address prominent display, TonAPI/Tavily as plain optional fields

## Note — 2026-02-21

Git history rewritten to fix commit attribution (email update from `tonresistor@github.com` to the account owner's actual email). All commit hashes changed; code, dates, and messages are identical. Tags re-pointed to new hashes. Force-pushed to origin. No code or functionality was affected.

## [0.6.0] - 2026-02-20

### Added
- **Cocoon Network** proxy-only LLM provider with XML tool injection
- **Moonshot** (Kimi K2.5 / K2 Thinking) LLM provider
- **Mistral** LLM provider
- **Pino structured logging** — migrated from console.* across entire codebase
- **MCP client support** with CLI management commands (`teleton mcp add/remove/list`)
- **Plugin Marketplace** with secrets management and download functionality
- **WebUI**: Config + MCP pages, custom Select component, centralized CSS
- **WebUI**: accordion UI, dashboard settings
- **Tool RAG**, web tools, and admin enhancements

### Changed
- Type safety overhaul: reduced `as any` from 135 to 32 instances
- Setup wizard migrated to `@inquirer/prompts` with auto-resolve owner
- All dependencies upgraded to latest versions

### Fixed
- Data integrity and cleanup from full audit

## [0.5.2] - 2026-02-16

### Added
- Auto-install npm dependencies for plugins on load

### Fixed
- Robust local embedding model loading (ONNX cache dir fix for global installs)

### Removed
- Dead dependencies from package.json
- Obsolete TGAPI.md documentation file

## [0.5.1] - 2026-02-16

### Changed
- CI/CD pipelines for SDK, WebUI, and Docker builds

## [0.5.0] - 2026-02-16

### Added
- Data-bearing tool categories with strict DB row types
- Plugin event hooks: `onMessage` and `onCallbackQuery`
- WebUI: inline dropdown task details with overflow fix
- WebUI: auth system, dashboard, tool config, plugins page, and documentation pages
- Plugin SDK expansion to 53 methods

### Changed
- RAG rebalancing for improved search relevance
- Core hardening and open-source cleanup
- Plugin SDK extraction to standalone package

### Fixed
- Key caching, transaction reliability, debouncer, and market extraction

## [0.4.0] - 2026-02-14

### Added
- Plugin SDK with namespaced services (`sdk.ton`, `sdk.telegram`, `sdk.db`)
- DeDust prices and token-info tools
- `/task` admin command connected to scheduled task system
- Local embeddings with hybrid vector search (sqlite-vec + FTS5)
- Casino extracted as external plugin

### Changed
- DEX tools reorganized by provider with scope security enforcement
- Memory init deduplicated, using `isVectorSearchReady()`
- System prompts hardened with memory size management
- Crypto-safe `randomId` used across codebase

### Fixed
- sqlite-vec startup logs no longer print before ASCII banner
- ChatId validation prevents entity resolution crashes on display names
- `DELETE+INSERT` for vec0 tables (upsert is unsupported)
- Auto-migrate legacy plugin data from `memory.db` on first startup
- Plugin SDK hardened: escape hatch removed, timeouts and cleanup added
- Sender ID always included for unambiguous user identification

### Removed
- Built-in casino module (replaced by external plugin)

## [0.3.0] - 2026-02-13

### Added
- Local ONNX embeddings (`Xenova/all-MiniLM-L6-v2`)
- Hybrid vector + FTS5 search for RAG

### Fixed
- Docker image name corrected in README
- Guard against undefined model from `pi-ai getModel()`
- Bot messages ignored in DMs to prevent bot-to-bot loops

## [0.2.5] - 2026-02-12

### Added
- Per-group module permissions with `/modules` admin command
- Swap tools allowed in groups with module level display

### Fixed
- `/clear` command crashing on missing vec0 table
- Post-audit hardening: timeouts, seqno race, cached endpoints
- Bot token made mandatory when deals module is enabled

### Removed
- Unused `@tonkite/highload-wallet-v3` dependency

## [0.2.4] - 2026-02-10

### Fixed
- Memory database properly closed on shutdown
- Atomic deal state guards prevent race conditions

## [0.2.3] - 2026-02-10

### Fixed
- MarketPriceService crash on fresh installs

## [0.2.2] - 2026-02-10

### Fixed
- Peer cache used in `bridge.getMessages` for reliable entity resolution

## [0.2.1] - 2026-02-10

### Changed
- Tool registration decentralized into co-located `ToolEntry` arrays

### Fixed
- Cached peer entity used in get-history for reliable channel resolution
- Mention detection fallback and duplicate message guard

## [0.2.0] - 2026-02-10

### Changed
- Deals and market extracted into standalone modules
- Gemini schema sanitizer for Google provider compatibility
- Casino extracted into self-contained plugin module

### Removed
- Dead casino files (game-executor, validators)

## [0.1.21] - 2026-02-09

### Added
- Prompt injection defense and tool context scoping

### Fixed
- `clearHistory` order, cached endpoint, tasks index
- `install.sh` reads from `/dev/tty` and uses lowercase Docker image name

### Removed
- Jackpot system removed entirely

## [0.1.20] - 2026-02-09

### Added
- `getTonPrice()` caching with 30-second TTL
- Completed deals logged to business journal
- Transcript files older than 30 days cleaned up at startup

### Fixed
- Shallow copy returned from `getTonPrice` cache

## [0.1.19] - 2026-02-08

### Fixed
- Folder IDs start at 2 (IDs 0-1 reserved by Telegram)
- `GetDialogFilters` returning object instead of array
- `DialogFilter` title wrapped in `TextWithEntities` for GramJS layer 222+
- Atomic status preconditions added to deal verify-payment

## [0.1.18] - 2026-02-08

### Added
- Optimized runtime logs and TonAPI rate limiting

## [0.1.17] - 2026-02-08

### Added
- `/boot` admin command for agent bootstrap

### Fixed
- Deals and Market merged into single module option
- Imperative placeholders removed from MEMORY.md template

## [0.1.16] - 2026-02-08

### Fixed
- Agent empty response when `memory_write` is the only tool call
- @ston-fi bundled with all transitive deps via external blacklist

## [0.1.15] - 2026-02-08

### Fixed
- @ston-fi bundled with all transitive dependencies

## [0.1.10 - 0.1.14] - 2026-02-08

### Fixed
- Repeated @ston-fi bundling and dependency resolution fixes
- `postinstall` script removed to avoid preinstall blocker

## [0.1.9] - 2026-02-08

### Fixed
- @ston-fi/api bundled to avoid pnpm-only install blocker

## [0.1.8] - 2026-02-08

### Fixed
- `scripts/` directory copied in Dockerfile build stage

## [0.1.7] - 2026-02-08

### Fixed
- Docker build issues resolved

## [0.1.6] - 2026-02-08

### Added
- First public npm release with Docker support

### Fixed
- Docker build failing due to husky in production install
- Docker tags lowercased, release decoupled from Docker

## [0.1.4 and earlier] - 2026-02-08

### Added
- Initial release of Teleton Agent
- Autonomous Telegram AI agent with TON blockchain integration
- Multi-provider LLM support (Anthropic, OpenAI, Google, xAI, Groq, OpenRouter)
- Deals system with inline bot, payment verification, and auto-execution
- Styled inline buttons and custom emoji via MTProto layer 222 patch
- Interactive setup wizard with wallet safety and model selection
- Admin commands: `/model`, `/policy`, `/pause`, `/resume`, `/wallet`, `/stop`, `/loop`
- TonAPI key support for higher rate limits
- Professional distribution (npm, Docker, CI/CD)
- Pre-commit hooks and linting infrastructure

[Unreleased]: https://github.com/TONresistor/teleton-agent/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/TONresistor/teleton-agent/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/TONresistor/teleton-agent/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/TONresistor/teleton-agent/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/TONresistor/teleton-agent/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/TONresistor/teleton-agent/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/TONresistor/teleton-agent/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/TONresistor/teleton-agent/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/TONresistor/teleton-agent/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/TONresistor/teleton-agent/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/TONresistor/teleton-agent/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/TONresistor/teleton-agent/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/TONresistor/teleton-agent/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/TONresistor/teleton-agent/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TONresistor/teleton-agent/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/TONresistor/teleton-agent/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/TONresistor/teleton-agent/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/TONresistor/teleton-agent/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/TONresistor/teleton-agent/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/TONresistor/teleton-agent/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/TONresistor/teleton-agent/compare/v0.1.21...v0.2.0
[0.1.21]: https://github.com/TONresistor/teleton-agent/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/TONresistor/teleton-agent/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/TONresistor/teleton-agent/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/TONresistor/teleton-agent/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/TONresistor/teleton-agent/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/TONresistor/teleton-agent/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/TONresistor/teleton-agent/compare/v0.1.14...v0.1.15
[0.1.10 - 0.1.14]: https://github.com/TONresistor/teleton-agent/compare/v0.1.9...v0.1.14
[0.1.9]: https://github.com/TONresistor/teleton-agent/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/TONresistor/teleton-agent/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/TONresistor/teleton-agent/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/TONresistor/teleton-agent/releases/tag/v0.1.6
[0.1.4 and earlier]: https://github.com/TONresistor/teleton-agent/releases/tag/v0.1.6
