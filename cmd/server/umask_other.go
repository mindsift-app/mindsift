//go:build !unix

package main

// privateFiles: there is no umask outside Unix, access follows the permissions of the folder.
func privateFiles() {}
