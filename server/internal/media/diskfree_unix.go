//go:build linux || darwin || freebsd

package media

import "syscall"

// FreeBytes is the space available to an unprivileged writer at path.
func FreeBytes(path string) (int64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	return int64(st.Bavail) * int64(st.Bsize), nil
}
