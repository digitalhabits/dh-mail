// Toasts have no meaning outside a browser. These record nothing on purpose:
// what a toast said is not what any of these suites is checking.
const noop = () => {};
export const toast = Object.assign(noop, {
  success: noop, error: noop, message: noop, loading: noop, warning: noop,
  custom: noop, dismiss: noop,
});
export default { toast };
