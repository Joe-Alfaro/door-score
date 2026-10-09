/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the console FastAPI backend. Defaults to http://localhost:8000. */
  readonly VITE_API_URL?: string
  /** Optional token sent as X-Console-Token on POST /api/run/*. */
  readonly VITE_CONSOLE_TOKEN?: string
}
