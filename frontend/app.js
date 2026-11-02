const API_BASE = (window.TRIMFUSE_API_BASE || "http://127.0.0.1:8765/api").replace(/\/+$/, "");
const PAGE_SIZE = 25;

const elements = {
  apiStatus: document.querySelector("#api-status"),
  datasetCount: document.querySelector("#dataset-count"),
  recordCount: document.querySelector("#record-count"),
  selectedCount: document.querySelector("#selected-count"),
  datasetSelect: document.querySelector("#dataset-select"),
  datasetList: document.querySelector("#dataset-list"),
  tableTitle: document.querySelector("#table-title"),
  tableDescription: document.querySelector("#table-description"),
  tableHead: document.querySelector("#table-head"),
  tableBody: document.querySelector("#table-body"),
  tableMessage: document.querySelector("#table-message"),
  searchInput: document.querySelector("#search-input"),
  resultCount: document.querySelector("#result-count"),
  pageLabel: document.querySelector("#page-label"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  refreshButton: document.querySelector("#refresh-button"),
  baselineResults: document.querySelector("#baseline-results"),
};

let datasets = [];
let currentSlug = "";
let currentOffset = 0;
let currentTotal = 0;
let searchTimer;
let requestNumber = 0;

function showTableMessage(message, isError = false) {
  elements.tableMessage.textContent = message;
  elements.tableMessage.classList.toggle("is-error", isError);
  elements.tableMessage.hidden = false;
  elements.tableBody.replaceChildren();
  elements.tableHead.replaceChildren();
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

function renderDatasetControls() {
  elements.datasetSelect.replaceChildren();
  elements.datasetList.replaceChildren();

  for (const dataset of datasets) {
    const option = document.createElement("option");
    option.value = dataset.slug;
    option.textContent = dataset.name;
    elements.datasetSelect.append(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dataset-item";
    button.setAttribute("aria-pressed", "false");
    button.append(document.createTextNode(dataset.name));
    const count = document.createElement("span");
    count.className = "dataset-item-count";
    count.textContent = `${dataset.rows.toLocaleString()} rows · ${dataset.column_count} fields`;
    button.append(count);
    button.addEventListener("click", () => selectDataset(dataset.slug));
    elements.datasetList.append(button);
  }

  elements.datasetSelect.disabled = false;
  elements.searchInput.disabled = false;
  elements.refreshButton.disabled = false;
  elements.datasetSelect.addEventListener("change", () => selectDataset(elements.datasetSelect.value));
}

function setActiveDataset() {
  for (const button of elements.datasetList.querySelectorAll(".dataset-item")) {
    const active = datasets.find((dataset) => dataset.name === button.firstChild.textContent)?.slug === currentSlug;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function selectDataset(slug) {
  if (!datasets.some((dataset) => dataset.slug === slug)) return;
  currentSlug = slug;
  currentOffset = 0;
  elements.datasetSelect.value = slug;
  elements.searchInput.value = "";
  setActiveDataset();
  loadRows();
}

function renderTable(data) {
  const headerRow = document.createElement("tr");
  for (const column of data.columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column;
    headerRow.append(th);
  }
  elements.tableHead.replaceChildren(headerRow);

  const rows = data.rows.map((record) => {
    const tr = document.createElement("tr");
    for (const column of data.columns) {
      const td = document.createElement("td");
      td.textContent = record[column] ?? "";
      td.title = record[column] ?? "";
      tr.append(td);
    }
    return tr;
  });
  elements.tableBody.replaceChildren(...rows);
}

async function loadRows() {
  if (!currentSlug) return;
  const thisRequest = ++requestNumber;
  const search = elements.searchInput.value.trim();
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(currentOffset),
    search,
  });

  elements.tableMessage.hidden = true;
  elements.tableTitle.textContent = "Loading…";
  elements.previousButton.disabled = true;
  elements.nextButton.disabled = true;

  try {
    const data = await fetchJson(`${API_BASE}/datasets/${encodeURIComponent(currentSlug)}/rows?${params}`);
    if (thisRequest !== requestNumber) return;
    currentTotal = data.total;
    elements.tableTitle.textContent = data.name;
    elements.tableDescription.textContent = data.description;
    elements.selectedCount.textContent = data.total.toLocaleString();
    elements.resultCount.textContent = `${data.total.toLocaleString()} matching records`;
    const first = data.total === 0 ? 0 : data.offset + 1;
    const last = Math.min(data.offset + data.rows.length, data.total);
    elements.pageLabel.textContent = data.total === 0
      ? "No records"
      : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${data.total.toLocaleString()}`;
    elements.previousButton.disabled = currentOffset === 0;
    elements.nextButton.disabled = currentOffset + PAGE_SIZE >= currentTotal;
    renderTable(data);
    if (data.rows.length === 0) showTableMessage("No records match this search.");
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    elements.tableTitle.textContent = "Dataset unavailable";
    elements.selectedCount.textContent = "—";
    elements.resultCount.textContent = "";
    elements.pageLabel.textContent = "—";
    showTableMessage(error.message, true);
    elements.apiStatus.textContent = "API error";
    elements.apiStatus.classList.add("is-error");
  }
}

async function loadBaseline() {
  try {
    const response = await fetch(`${API_BASE}/baseline`);
    if (!response.ok) throw new Error("Baseline results are unavailable.");
    elements.baselineResults.textContent = await response.text();
  } catch {
    elements.baselineResults.textContent = "Could not load baseline results. Check that the backend is running.";
  }
}

async function initialize() {
  try {
    const [health, response] = await Promise.all([
      fetchJson(`${API_BASE}/health`),
      fetchJson(`${API_BASE}/datasets`),
    ]);
    if (health.status !== "ok") throw new Error("API health check failed.");
    datasets = response.datasets;
    elements.apiStatus.textContent = "API connected";
    elements.apiStatus.classList.remove("is-error");
    elements.datasetCount.textContent = datasets.length.toLocaleString();
    elements.recordCount.textContent = datasets.reduce((total, item) => total + item.rows, 0).toLocaleString();
    renderDatasetControls();
    if (datasets.length > 0) selectDataset(datasets[0].slug);
    else showTableMessage("No datasets were found.");
  } catch (error) {
    elements.apiStatus.textContent = "API offline";
    elements.apiStatus.classList.add("is-error");
    elements.datasetCount.textContent = "—";
    elements.recordCount.textContent = "—";
    showTableMessage(`${error.message} Start the backend and refresh this page.`, true);
  }
  loadBaseline();
}

elements.searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    currentOffset = 0;
    loadRows();
  }, 250);
});
elements.previousButton.addEventListener("click", () => {
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  loadRows();
});
elements.nextButton.addEventListener("click", () => {
  if (currentOffset + PAGE_SIZE < currentTotal) {
    currentOffset += PAGE_SIZE;
    loadRows();
  }
});
elements.refreshButton.addEventListener("click", () => {
  if (currentSlug) loadRows();
});

initialize();
