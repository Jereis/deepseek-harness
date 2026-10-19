// Windows installation directory permissions: an own access list instead of the parent's inherited entries.
#pragma once
#include <aclapi.h>
#include <new>
#include <string>

namespace install_directory {
// Grants full control to SYSTEM, Administrators, and the installing user, inherited by everything written below,
// and drops entries inherited from the parent. Unresolvable AppContainer SIDs inherited from %LOCALAPPDATA% make
// Chromium's GPU sandbox exit with 0x80000003 until the browser stops with "GPU process isn't usable".
// Returns a Win32 error code.
inline DWORD Protect(LPCWSTR path) {
    if (!path || !*path) return ERROR_INVALID_PARAMETER;
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return GetLastError();
    DWORD size = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &size);
    BYTE* user = size > 0 ? new (std::nothrow) BYTE[size] : nullptr;
    DWORD error = ERROR_SUCCESS;
    if (!user) error = ERROR_NOT_ENOUGH_MEMORY;
    else if (!GetTokenInformation(token, TokenUser, user, size, &size)) error = GetLastError();
    CloseHandle(token);
    if (error != ERROR_SUCCESS) {
        delete[] user;
        return error;
    }

    BYTE system[SECURITY_MAX_SID_SIZE];
    BYTE administrators[SECURITY_MAX_SID_SIZE];
    DWORD systemSize = sizeof(system);
    DWORD administratorsSize = sizeof(administrators);
    if (!CreateWellKnownSid(WinLocalSystemSid, nullptr, system, &systemSize)
        || !CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, administrators, &administratorsSize)) {
        error = GetLastError();
        delete[] user;
        return error;
    }

    PSID trustees[] = {system, administrators, reinterpret_cast<TOKEN_USER*>(user)->User.Sid};
    EXPLICIT_ACCESSW entries[ARRAYSIZE(trustees)] = {};
    for (size_t index = 0; index < ARRAYSIZE(trustees); ++index) {
        entries[index].grfAccessPermissions = FILE_ALL_ACCESS;
        entries[index].grfAccessMode = SET_ACCESS;
        entries[index].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
        entries[index].Trustee.TrusteeForm = TRUSTEE_IS_SID;
        entries[index].Trustee.TrusteeType = TRUSTEE_IS_UNKNOWN;
        entries[index].Trustee.ptstrName = static_cast<LPWSTR>(trustees[index]);
    }
    PACL acl = nullptr;
    error = SetEntriesInAclW(ARRAYSIZE(entries), entries, nullptr, &acl);
    if (error == ERROR_SUCCESS) {
        std::wstring target(path);
        error = SetNamedSecurityInfoW(&target[0], SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, nullptr, nullptr, acl, nullptr);
        LocalFree(acl);
    }
    delete[] user;
    return error;
}
}
