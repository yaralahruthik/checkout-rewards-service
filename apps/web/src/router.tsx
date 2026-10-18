import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AdminPage } from "@/features/admin/AdminPage";
import { CartPage } from "@/features/cart/CartPage";
import { CatalogPage } from "@/features/catalog/CatalogPage";

const navLinks = [
  { to: "/", label: "Catalog" },
  { to: "/cart", label: "Cart" },
  { to: "/admin", label: "Admin" },
] as const;

const Layout = () => (
  <>
    <nav className="border-b">
      <div className="mx-auto flex max-w-5xl gap-4 px-6 py-3 text-sm">
        {navLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="text-muted-foreground hover:text-foreground"
            activeProps={{ className: "font-medium text-foreground" }}
            activeOptions={{ exact: true }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
    <Outlet />
  </>
);

const rootRoute = createRootRoute({ component: Layout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: CatalogPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/cart", component: CartPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: AdminPage }),
]);

/** Code-based routes: three pages do not need file-based routing and its codegen. */
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
