#pragma once

#include <string>
#include <memory>
#include <wrl.h>
#include <wil/com.h>

inline std::wstring GetExecutableDirectory() {
    wchar_t buffer[MAX_PATH];
    DWORD charsWritten = GetModuleFileName(nullptr, buffer, ARRAYSIZE(buffer));
    THROW_LAST_ERROR_IF(charsWritten == 0 || charsWritten == ARRAYSIZE(buffer));
    std::wstring executablePath(buffer);
    std::wstring::size_type lastBackslash = executablePath.find_last_of(L"\\");
    THROW_HR_IF(HRESULT_FROM_WIN32(ERROR_MOD_NOT_FOUND), lastBackslash == std::wstring::npos);
    return executablePath.substr(0, lastBackslash);
}

inline std::wstring GetPathRelativeToExecutable(const wchar_t* relativePath) {
    return GetExecutableDirectory() + L"\\" + relativePath;
}

template<typename T>
class Dispatchable: public Microsoft::WRL::RuntimeClass<
    Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
    T, IDispatch>
{
public:
    STDMETHODIMP GetTypeInfoCount(UINT* pctinfo) override {
        *pctinfo = 1;
        return S_OK;
    }

    STDMETHODIMP GetTypeInfo(UINT iTInfo, LCID lcid, ITypeInfo** ppTInfo) override try {
        if (0 != iTInfo) {
            return TYPE_E_ELEMENTNOTFOUND;
        }
        if (!m_typeLib) {
            THROW_IF_FAILED(LoadTypeLib(GetPathRelativeToExecutable(L"sic1.tlb").c_str(), &m_typeLib));
        }
        THROW_IF_FAILED(m_typeLib->GetTypeInfoOfGuid(__uuidof(T), ppTInfo));
        return S_OK;
    }
    CATCH_RETURN();

    STDMETHODIMP GetIDsOfNames(REFIID riid, LPOLESTR* rgszNames, UINT cNames, LCID lcid, DISPID* rgDispId) override {
        wil::com_ptr<ITypeInfo> typeInfo;
        RETURN_IF_FAILED(GetTypeInfo(0, lcid, &typeInfo));
        return typeInfo->GetIDsOfNames(rgszNames, cNames, rgDispId);
    }

    STDMETHODIMP Invoke(DISPID dispIdMember, REFIID riid, LCID lcid, WORD wFlags, DISPPARAMS* pDispParams, VARIANT* pVarResult, EXCEPINFO* pExcepInfo, UINT* puArgErr) override {
        wil::com_ptr<ITypeInfo> typeInfo;
        RETURN_IF_FAILED(GetTypeInfo(0, lcid, &typeInfo));
        return typeInfo->Invoke(this, dispIdMember, wFlags, pDispParams, pVarResult, pExcepInfo, puArgErr);
    }

private:
    wil::com_ptr<ITypeLib> m_typeLib;
};
