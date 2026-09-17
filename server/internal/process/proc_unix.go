//go:build !windows

package process

import (
	"os/exec"
	"syscall"
	"time"
)

// configureProcess puts ffmpeg in its own process group and kills the whole
// group on cancellation, so a shutdown never leaves an orphaned encoder
// holding CPU and a half-written temp file.
func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = 5 * time.Second
}
