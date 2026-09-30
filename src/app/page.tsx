import { Importer } from "./components/Importer";
import { loadCatalog } from "./lib/catalog";

export default function Home() {
  const catalog = loadCatalog();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">CardOpt</h1>
        <p className="max-w-2xl text-base text-muted">
          Import your credit card statements to see where your money goes. Your files are read in
          this browser and are never uploaded.
        </p>
      </header>
      <Importer catalog={catalog} />
    </main>
  );
}
