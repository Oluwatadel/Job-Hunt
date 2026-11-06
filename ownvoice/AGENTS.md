# OwnVoice shared source

This separate application uses Floot project `d55a2adb-0461-4e79-99dd-b48279ba426d`, not the parent Job Hunt project.

The shared source is `floot/`; local runtime and package files stay local. Maintain both copies. Before editing, read current remote state and compare the managed files with `.floot-sync/manifest.json`. Pull nonconflicting changes; stop and preserve both versions on competing edits or deletions. The manifest covers only the shared files used by this local app, not Floot's unused seeded kit.

Use expected_version on every remote write. Read changed files back and compare content exactly, run local build/tests/typecheck and Floot typechecking, and only then refresh the manifest. Do not claim synchronization without verification. Keep secrets out of source and logs. Publishing and new paid services remain separate release steps. Do not publish the unprotected prototype endpoint publicly.

Do not claim guaranteed detector evasion or competitor superiority without evidence. Keep reviewable meaning and citation integrity central.
