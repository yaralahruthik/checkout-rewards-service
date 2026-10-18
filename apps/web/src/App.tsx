import { useSyncExternalStore } from "react";
import { AdminPage } from "@/features/admin/AdminPage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { cn } from "@/lib/utils";

const pages = [
  { hash: "#/", label: "Catalog", Page: CatalogPage },
  { hash: "#/admin", label: "Admin", Page: AdminPage },
] as const;

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/** Hash routing: a handful of pages does not justify a router dependency. */
const useHash = () => useSyncExternalStore(subscribe, () => window.location.hash || "#/");

export const App = () => {
  const hash = useHash();
  const current = pages.find((page) => page.hash === hash) ?? pages[0];

  return (
    <>
      <nav className="border-b">
        <div className="mx-auto flex max-w-5xl gap-4 px-6 py-3 text-sm">
          {pages.map((page) => (
            <a
              key={page.hash}
              href={page.hash}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                page === current && "font-medium text-foreground",
              )}
            >
              {page.label}
            </a>
          ))}
        </div>
      </nav>
      <current.Page />
    </>
  );
};
