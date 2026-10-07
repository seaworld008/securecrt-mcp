import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bridge' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Screen:
    Get2 = Get = ReadString = Send = lambda *args: (_ for _ in ()).throw(AssertionError('probe must not invoke terminal I/O'))
    CurrentRow = CurrentColumn = Rows = Columns = MatchIndex = 1
    Synchronous = IgnoreEscape = False


class Session:
    Connected = True
    SessionName = TabText = 'test'
    SelectTabName = Sleep = lambda *args: None


class Tab:
    Screen = Screen()
    Session = Session()
    Caption = 'test'
    Index = 1


class App:
    Screen = Screen()
    Session = Session()
    Version = 'test'
    Sleep = lambda *args: None
    GetTabCount = lambda *args: 1
    GetTab = lambda *args: Tab()


def test_securecrt_probe_reads_availability_without_send_readstring_or_get2():
    probe = module('securecrt_bridge').probe_capabilities(App())
    assert probe['tab.Screen.Send'] is True and probe['tab.Screen.Get2'] is True
    assert probe['tab.Screen.Synchronous'] is True
    assert probe['tab.Session.Config.GetOption'] is False


def test_tabless_probe_reports_unknown_not_false():
    app = App()
    app.GetTabCount = lambda: 0
    probe = module('securecrt_bridge').probe_capabilities(app)
    assert probe['crt.GetTabCount'] is True
    assert probe['tab.Screen.Get2'] is None


def test_xshell_probe_reports_missing_native_wait_without_invoking_send():
    probe = module('xshell_bridge').probe_capabilities(App())
    assert probe['xsh.Screen.Send'] is True
    assert probe['xsh.Session.Sleep'] is True
    assert probe['xsh.Screen.WaitForStrings'] is False
