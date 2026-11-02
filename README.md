# Trim & Fuse Data Explorer

The application separates the browser interface from the read-only Python API:

- `frontend/` contains the HTML, CSS, and JavaScript interface.
- `backend/` contains the Python API server.
- The API reads the existing synthetic CSVs under `Dataset/trimfuse_synthetic_dataset/trimfuse_synth/data/`.

The application uses only Python's standard library and has no npm dependencies.

## Run locally on Windows

Open two PowerShell terminals in the project root.

**Terminal 1 — backend API**

```powershell
python backend\server.py
```

The API listens at `http://127.0.0.1:8765`.

**Terminal 2 — frontend**

```powershell
python -m http.server 5500 --directory frontend
```

Open `http://127.0.0.1:5500` in a browser. Keep both terminals running while using the app. Stop either server with `Ctrl+C`.

## API routes

- `GET /api/health` — API status.
- `GET /api/datasets` — dataset names, descriptions, row counts, and field counts.
- `GET /api/datasets/{slug}/rows?limit=25&offset=0&search=` — paginated, case-insensitive search.
- `GET /api/baseline` — supplied baseline model results.

The API is read-only and only serves the CSV files listed in its allowlist. It is intended for exploring the supplied synthetic data, not for production fuse programming or manufacturing decisions.

## Deploy frontend to GitHub Pages and API to Render

The frontend is static and can run on GitHub Pages. The Python API must run on a Python hosting service; this project includes a Render blueprint at `render.yaml`.

1. Create a GitHub repository and upload/push this project, including the `Dataset`, `frontend`, `backend`, `.github`, and `render.yaml` files. Do not publish production or customer data.
2. In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the deployment source. The workflow at `.github/workflows/deploy-frontend.yml` publishes the `frontend/` directory when you push to `main` or `master`.
3. In Render, create a new Blueprint from the GitHub repository and deploy `render.yaml`. Copy the deployed API base URL, ending in `/api` (for example, `https://your-service.onrender.com/api`).
4. In GitHub, edit `frontend/config.js`, replacing the local URL with the Render API base URL, then commit and push that change.
5. In Render, set the `CORS_ALLOWED_ORIGINS` environment variable to the exact GitHub Pages site origin shown in the browser address bar (for example, `https://your-user.github.io`). Do not include a path or trailing slash. If using a project site, the origin is still `https://your-user.github.io`, not the `/repository-name` portion.

After both deployments finish, open the GitHub Pages URL. The frontend and backend are deployed separately; the GitHub Actions workflow publishes only the frontend.
