/**
 * Minimal Swagger UI page generator.
 *
 * Returns a self-contained HTML page that loads Swagger UI from a pinned CDN
 * and renders the supplied OpenAPI spec URL. Used by the Management API to
 * serve interactive docs at `/api/docs` in development mode, and by the static
 * docs generator to write `docs/api-reference/index.html`.
 */

/** Pinned Swagger UI distribution version (unpkg CDN). */
const SWAGGER_UI_VERSION = "5.17.14";

/**
 * Build a Swagger UI HTML page.
 *
 * @param specUrl URL the UI fetches the OpenAPI document from.
 * @param title   Page `<title>`.
 */
export function swaggerUiHtml(specUrl: string, title = "Teleton Management API"): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css"
    />
    <style>
      body { margin: 0; background: #fafafa; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(specUrl)},
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: "BaseLayout",
        });
      });
    </script>
  </body>
</html>
`;
}
