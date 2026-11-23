# shellcheck shell=sh
# Shared by the desktop builds (desktop/build.sh, desktop/packaging/flatpak/build.sh,
# desktop/packaging/windows/build.sh); sourced by sh with ENGINE and COPY_MODE set.
#
# run_in IMAGE HOSTDIR MOUNT WORKDIR OUTDIRS COMMAND [ENGINE OPTIONS…]: runs COMMAND (sh -c) in IMAGE with
# the folder HOSTDIR at MOUNT and MOUNT/WORKDIR as working directory ("." for MOUNT itself). What COMMAND
# leaves in OUTDIRS (relative to MOUNT, separated by spaces, "." for all of it) ends up in the same folders
# of HOSTDIR. The options (volumes, capabilities …) go to the engine as they are.
#   Locally (COPY_MODE=0): HOSTDIR is bind-mounted, so the results are there already.
#   CI (COPY_MODE=1, ENGINE=docker): the job may run in a container itself, where the paths of the Docker
#   host differ from ours, so HOSTDIR is copied into the container and OUTDIRS copied back afterwards,
#   only when COMMAND succeeded. Without .git (the checkout's credentials and history are no business of
#   the build) and without frontend/node_modules (npm ci installs them fresh); the copy is a tar stream
#   of GNU tar, which unpacks as MOUNT.
run_in() {
  ri_image="$1"; ri_host="$2"; ri_mount="$3"; ri_workdir="$4"; ri_outdirs="$5"; ri_cmd="$6"
  shift 6
  ri_wd="$ri_mount"
  [ "$ri_workdir" = . ] || ri_wd="$ri_mount/$ri_workdir"
  if [ "$COPY_MODE" != "1" ]; then
    $ENGINE run --rm "$@" -v "$ri_host":"$ri_mount":Z -w "$ri_wd" "$ri_image" sh -c "$ri_cmd"
    return
  fi
  ri_id="$($ENGINE create "$@" -w "$ri_wd" "$ri_image" sh -c "$ri_cmd")"
  ri_status=0
  tar -C "$ri_host" --exclude=./.git --exclude=./frontend/node_modules --transform "s,^\\.,${ri_mount#/}," -cf - . \
    | $ENGINE cp - "$ri_id:/" && $ENGINE start -a "$ri_id" || ri_status=$?
  if [ "$ri_status" = 0 ]; then
    for ri_out in $ri_outdirs; do
      if [ "$ri_out" = . ]; then ri_from="$ri_mount/." ri_to="$ri_host"; else ri_from="$ri_mount/$ri_out/." ri_to="$ri_host/$ri_out"; fi
      mkdir -p "$ri_to"
      $ENGINE cp "$ri_id:$ri_from" "$ri_to" || ri_status=$?
    done
  fi
  $ENGINE rm -f "$ri_id" >/dev/null
  return "$ri_status"
}
