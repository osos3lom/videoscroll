//go:build windows

package process

import (
	"os/exec"
	"time"
)

// configureProcess: Windows is a development target only; CommandContext's
// default Process.Kill is sufficient there.
func configureProcess(cmd *exec.Cmd) {
	cmd.WaitDelay = 5 * time.Second
}
