"""IPA from the full espeak-ng (espeakng_loader wheel) for any language: python3 -I espeak_ipa.py de "text" ..."""
import ctypes, sys
import espeakng_loader as E
lib = ctypes.cdll.LoadLibrary(E.get_library_path())
lib.espeak_Initialize.restype = ctypes.c_int
lib.espeak_Initialize(0x02, 0, E.get_data_path().encode(), 0)
lib.espeak_SetVoiceByName.argtypes = [ctypes.c_char_p]
lib.espeak_TextToPhonemes.restype = ctypes.c_char_p
lib.espeak_TextToPhonemes.argtypes = [ctypes.POINTER(ctypes.c_char_p), ctypes.c_int, ctypes.c_int]
def ipa(text, lang):
    lib.espeak_SetVoiceByName(lang.encode())
    buf = ctypes.c_char_p(text.encode()); p = ctypes.pointer(buf); out = []
    while p.contents.value:
        r = lib.espeak_TextToPhonemes(p, 1, 0x02)  # UTF-8 in, IPA out
        if r: out.append(r.decode())
    return " ".join(out)
if __name__ == "__main__":
    lang = sys.argv[1]
    for t in sys.argv[2:]: print(t, "=>", ipa(t, lang))
