const WEATHER_KINDS = ["clear", "rain", "snow", "storm"];
const DEFAULT_CONFIG = { mode: "automatic", weather: "clear", distribution: { clear: 58, rain: 17, snow: 17, storm: 8 } };

function configFrom(snapshot) {
  const saved = snapshot.plugins?.weather;
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    distribution: { ...DEFAULT_CONFIG.distribution, ...saved?.distribution },
  };
}

function label(text, control) {
  const element = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = text;
  element.append(caption, control);
  return element;
}

export function mountAdminPlugin({ container, action }) {
  const section = document.createElement("section");
  section.className = "hosted-section";
  const title = document.createElement("h2");
  title.textContent = "Weather settings";
  const note = document.createElement("p");
  note.className = "hosted-note";
  note.textContent = "Choose one permanent sky, or let every visitor share a weighted hourly forecast.";

  const form = document.createElement("form");
  form.className = "hosted-form";
  const mode = document.createElement("select");
  mode.innerHTML = '<option value="automatic">Automatic schedule</option><option value="permanent">Permanent weather</option>';
  const permanent = document.createElement("select");
  for (const kind of WEATHER_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind[0].toUpperCase() + kind.slice(1);
    permanent.append(option);
  }
  const grid = document.createElement("div");
  grid.className = "hosted-grid weather-config__distribution";
  const fields = {};
  for (const kind of WEATHER_KINDS) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.inputMode = "numeric";
    fields[kind] = input;
    grid.append(label(`${kind[0].toUpperCase() + kind.slice(1)} %`, input));
  }
  const total = document.createElement("p");
  total.className = "hosted-note";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save weather";
  const status = document.createElement("p");
  status.className = "hosted-status";
  status.setAttribute("role", "status");
  form.append(label("Mode", mode), label("Weather", permanent), grid, total, save, status);
  section.append(title, note, form);
  container.appendChild(section);

  function sync() {
    const automatic = mode.value === "automatic";
    permanent.disabled = automatic;
    grid.hidden = !automatic;
    total.hidden = !automatic;
  }

  function updateTotal() {
    const sum = WEATHER_KINDS.reduce((totalValue, kind) => totalValue + Number(fields[kind].value || 0), 0);
    total.textContent = `Total: ${sum}%${sum === 100 ? "" : " — must equal 100%"}`;
    total.classList.toggle("hosted-status--error", sum !== 100);
    return sum;
  }

  mode.addEventListener("change", sync);
  for (const input of Object.values(fields)) input.addEventListener("input", updateTotal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (mode.value === "automatic" && updateTotal() !== 100) {
      status.textContent = "Weather percentages must add up to 100%.";
      status.classList.add("hosted-status--error");
      return;
    }
    save.disabled = true;
    status.textContent = "Saving…";
    status.classList.remove("hosted-status--error");
    const ok = await action("update", {
      mode: mode.value,
      weather: permanent.value,
      distribution: Object.fromEntries(WEATHER_KINDS.map((kind) => [kind, Number(fields[kind].value)])),
    });
    save.disabled = false;
    if (ok) status.textContent = "Saved.";
  });

  return {
    render(snapshot) {
      const config = configFrom(snapshot);
      mode.value = config.mode;
      permanent.value = config.weather;
      for (const kind of WEATHER_KINDS) fields[kind].value = String(config.distribution[kind]);
      sync();
      updateTotal();
    },
    destroy() { section.remove(); },
  };
}
