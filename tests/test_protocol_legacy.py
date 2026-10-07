from protocol_harness import SUPPORTED, wire_server


def initialize(client, version):
    return client.request('initialize', {'protocolVersion': version, 'capabilities': {},
                          'clientInfo': {'name': 'legacy-consistency', 'version': '1'}})


def test_legacy_initialize_tools_and_rejection_have_legacy_shapes():
    with wire_server() as (client, bridge):
        reply = initialize(client, '2025-11-25')
        assert reply['result']['protocolVersion'] == '2025-11-25'
        assert reply['result']['serverInfo']['name'] == 'securecrt-mcp'
        assert 'tools' in reply['result']['capabilities']
        client.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        tools = client.request('tools/list', {})['result']
        assert len(tools['tools']) == 17
        assert 'resultType' not in tools
        reply = client.request('tools/call', {'name': 'connector_open', 'arguments': {
            'backend': 'openssh', 'target': '-untrusted-option', 'mode': 'exec'}})
        assert reply['error']['code'] == -32602
        assert not bridge.sent


def test_unsupported_legacy_handshake_is_not_silently_downgraded():
    for version in ('1900-01-01', '2025-06-18'):
        with wire_server() as (client, bridge):
            reply = initialize(client, version)
            assert reply['error']['code'] == -32022, reply
            assert reply['error']['data'] == {'supported': SUPPORTED, 'requested': version}
            client.process.wait(timeout=5)
            assert not bridge.sent


def test_known_modern_version_on_legacy_entrypoint_has_actionable_error():
    with wire_server() as (client, bridge):
        reply = initialize(client, '2026-07-28')
        assert reply['error']['code'] == -32600
        assert 'server/discover' in reply['error']['message']
        client.process.wait(timeout=5)
        assert not bridge.sent
