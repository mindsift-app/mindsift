// mksyso writes the Windows resources of the desktop exe as a .syso file next to the program's sources,
// where `go build` links it in: the app icon (resource id 3, where Wails looks for the window's icon),
// the version information (shown in the file's properties and the task manager) and the application
// manifest (DPI awareness, visual styles) that Wails' own build uses. It is what `wails3 generate syso`
// does, built on the same library (github.com/tc-hib/winres, the version Wails pins), without the whole
// Wails command line.
//
//	go run ./tools/mksyso -ico packaging/windows/app.ico -version 0.97.1-desktop-spike -out resource_windows_amd64.syso
package main

import (
	"flag"
	"fmt"
	"os"
	"regexp"

	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
)

const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
    <assemblyIdentity type="win32" name="app.mindsift.MindSift" version="%s" processorArchitecture="*"/>
    <dependency>
        <dependentAssembly>
            <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
        </dependentAssembly>
    </dependency>
    <asmv3:application>
        <asmv3:windowsSettings>
            <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
            <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">permonitorv2,permonitor</dpiAwareness>
        </asmv3:windowsSettings>
    </asmv3:application>
    <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
        <security>
            <requestedPrivileges>
                <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
            </requestedPrivileges>
        </security>
    </trustInfo>
</assembly>`

func main() {
	ico := flag.String("ico", "", "the .ico file")
	out := flag.String("out", "", "the .syso file to write")
	ver := flag.String("version", "0.0.0", "the version, e.g. 0.97.1 or 0.97.1-desktop-spike")
	arch := flag.String("arch", "amd64", "amd64, arm64 or 386")
	flag.Parse()
	if err := run(*ico, *out, *ver, *arch); err != nil {
		fmt.Fprintln(os.Stderr, "mksyso:", err)
		os.Exit(1)
	}
}

func run(icoPath, outPath, ver, arch string) error {
	targets := map[string]winres.Arch{"amd64": winres.ArchAMD64, "arm64": winres.ArchARM64, "386": winres.ArchI386}
	target, ok := targets[arch]
	if !ok {
		return fmt.Errorf("arch %q is not supported", arch)
	}
	if icoPath == "" || outPath == "" {
		return fmt.Errorf("-ico and -out are required")
	}
	// The numeric part of the version for the fixed fields ("0.97.1-desktop-spike" → 0.97.1.0)
	m := regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)`).FindStringSubmatch(ver)
	if m == nil {
		return fmt.Errorf("version %q does not start with x.y.z", ver)
	}
	numeric := fmt.Sprintf("%s.%s.%s.0", m[1], m[2], m[3])

	f, err := os.Open(icoPath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	icon, err := winres.LoadICO(f)
	if err != nil {
		return fmt.Errorf("icon %s: %w", icoPath, err)
	}

	rs := winres.ResourceSet{}
	// Wails loads the window's icon from the resource with id 3 (RT_ICON as a name)
	if err := rs.SetIcon(winres.RT_ICON, icon); err != nil {
		return err
	}
	xml, err := winres.AppManifestFromXML([]byte(fmt.Sprintf(manifest, numeric)))
	if err != nil {
		return err
	}
	rs.SetManifest(xml)

	var vi version.Info
	// The strings first (English), so the version calls below find that one language and do not add a neutral one
	for k, v := range map[string]string{
		version.ProductName:      "MindSift",
		version.FileDescription:  "MindSift desktop",
		version.InternalName:     "mindsift-desktop",
		version.OriginalFilename: "mindsift-desktop.exe",
		version.CompanyName:      "MindSift",
		version.LegalCopyright:   "MindSift",
	} {
		if err := vi.Set(version.LangDefault, k, v); err != nil {
			return err
		}
	}
	// The fixed numbers, then the strings with the full version (including a suffix like -desktop-spike)
	vi.SetFileVersion(numeric)
	vi.SetProductVersion(numeric)
	for _, k := range []string{version.FileVersion, version.ProductVersion} {
		if err := vi.Set(version.LangDefault, k, ver); err != nil {
			return err
		}
	}
	rs.SetVersionInfo(vi)

	o, err := os.Create(outPath)
	if err != nil {
		return err
	}
	if err := rs.WriteObject(o, target); err != nil {
		_ = o.Close()
		return err
	}
	return o.Close()
}
