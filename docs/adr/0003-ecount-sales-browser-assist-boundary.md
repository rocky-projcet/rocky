# Separate ECOUNT Open API and browser-assist sales boundaries

Rocky will not treat a successful ECOUNT Open API connection as sufficient for ECOUNT sales export. Sales inquiry data without a verified official read endpoint is modeled as an ECOUNT sales export behind a separate browser-assist web-session boundary, while official Open API reads remain behind the ECOUNT Open API connection. This adds setup complexity, but avoids assuming the API key issuer can log into the web UI, avoids coupling to unverified internal ERP APIs, and keeps browser-assisted reads distinct from API capabilities.
