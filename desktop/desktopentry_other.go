//go:build !linux

package main

// registerDesktopEntry: only Linux has desktop entries (Windows takes its icon from the exe's resources)
func registerDesktopEntry() {}
