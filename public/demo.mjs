import { mountTownSquare } from "./townsquare.mjs";

const root = document.getElementById("townsquare-root");
if (!root) {
  throw new Error("TownSquare demo root element not found");
}

mountTownSquare(root, {
  socketPath: "/live",
  hint: "This same square can live on your website with one pasted snippet.",
});
