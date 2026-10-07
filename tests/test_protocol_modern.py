from protocol_harness import SUPPORTED, modern_meta, wire_server


def test_modern_discovery_and_inline_tools_without_initialize():
    with wire_server() as (client, bridge):
        discovered = client.request('server/discover', {'_meta': modern_meta()})['result']
        assert discovered['supportedVersions'] == SUPPORTED, discovered
        assert discovered['resultType'] == 'complete'
        assert discovered['_meta']['io.modelcontextprotocol/serverInfo']['name'] == 'securecrt-mcp'
        assert discovered['cacheScope'] == 'private' and discovered['ttlMs'] == 0
        tools = client.request('tools/list', {'_meta': modern_meta()})['result']
        assert len(tools['tools']) == 17
        assert tools['resultType'] == 'complete'
        denied = client.request('tools/call', {'_meta': modern_meta(), 'name': 'connector_open',
            'arguments': {'backend': 'openssh', 'target': '-untrusted-option', 'mode': 'exec'}})
        assert denied['error']['code'] == -32602
        assert not bridge.sent
    with wire_server() as (client, _):
        # Discovery is optional, not a disguised initialization handshake.
        assert 'tools' in client.request('tools/list', {'_meta': modern_meta()})['result']


def test_modern_version_is_validated_on_every_request_and_can_recover():
    with wire_server() as (client, bridge):
        client.request('server/discover', {'_meta': modern_meta()})
        for version in ('1900-01-01', '2025-06-18', '2027-01-01'):
            reply = client.request('tools/list', {'_meta': modern_meta(version)})
            assert reply['error']['code'] == -32022, reply
            assert reply['error']['data'] == {'supported': SUPPORTED, 'requested': version}
        assert 'tools' in client.request('tools/list', {'_meta': modern_meta()})['result']
        assert not bridge.sent


def test_modern_missing_or_malformed_request_metadata_rejects_before_tools():
    with wire_server() as (client, bridge):
        client.request('server/discover', {'_meta': modern_meta()})
        for meta in ({}, {'io.modelcontextprotocol/protocolVersion': '2026-07-28'},
                     {'io.modelcontextprotocol/protocolVersion': 123,
                      'io.modelcontextprotocol/clientCapabilities': {}},
                     {'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                      'io.modelcontextprotocol/clientCapabilities': 'malformed'}):
            reply = client.request('tools/call', {'_meta': meta, 'name': 'connector_list', 'arguments': {}})
            assert reply['error']['code'] == -32602, reply
        assert not bridge.sent
