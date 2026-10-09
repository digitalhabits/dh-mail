import * as React from "react";

/**
 * Stand-in for next/dynamic, so this build needs no framework.
 *
 * A shared component loads the rich text editor lazily and reached for Next to
 * do it. The standalone has no Next — it resolved only because another
 * app's copy sat further up the directory tree, which is the kind of dependency that
 * works until the code is moved anywhere else.
 *
 * `ssr: false` needs no equivalent here: nothing renders on a server.
 */

type DynamicOptions = {
  ssr?: boolean;
  loading?: () => React.ReactNode;
};

/**
 * Next takes either shape from a loader, and callers use both.
 *
 * `import("…")` gives a module with a `default`; an inline `async () => Comp`
 * gives the component itself. A shim that accepts only the first typechecks
 * fine until someone writes the second, which is why the To-Do copy of this
 * has carried an error for months.
 */
type Loaded<P> = React.ComponentType<P> | { default: React.ComponentType<P> };

export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  options: DynamicOptions = {}
): React.ComponentType<P> {
  // React.lazy's own type does not describe a component that takes props
  // through a generic, so the cast goes via unknown. The runtime behaviour is
  // exactly React.lazy; only the declared type is being widened.
  const Lazy = React.lazy(async () => {
    const loaded = await loader();
    return typeof loaded === "function" ? { default: loaded } : loaded;
  }) as unknown as React.ComponentType<P>;

  function DynamicComponent(props: P) {
    return (
      <React.Suspense fallback={options.loading ? options.loading() : null}>
        <Lazy {...props} />
      </React.Suspense>
    );
  }

  DynamicComponent.displayName = "NextDynamicShim";
  return DynamicComponent;
}
