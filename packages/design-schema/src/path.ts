const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\[^\\/]+[\\/][^\\/]+/;

/**
 * Checks a file path against the conventions of the current and the other
 * supported desktop operating systems (POSIX, Windows drive letters and UNC
 * shares). Documents may travel between platforms, so a path that is absolute
 * on any supported system is accepted.
 */
export function isSystemAbsolutePath(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  return (
    value.startsWith('/') ||
    WINDOWS_DRIVE_PATH.test(value) ||
    WINDOWS_UNC_PATH.test(value)
  );
}
