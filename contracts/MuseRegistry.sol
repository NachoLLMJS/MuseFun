// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MuseRegistry
/// @notice Permissionless, non-custodial identity registry. One active Muse per wallet.
contract MuseRegistry {
    struct Muse {
        string name;
        string metadataURI;
        uint64 registeredAt;
        uint64 updatedAt;
        bool active;
    }

    mapping(address owner => Muse muse) private _muses;
    mapping(bytes32 nameHash => address owner) private _nameOwners;
    address[] private _owners;

    error AlreadyRegistered();
    error InvalidName();
    error InvalidMetadataURI();
    error NameUnavailable();
    error NotRegistered();

    event MuseRegistered(address indexed owner, bytes32 indexed nameHash, string name, string metadataURI);
    event MuseUpdated(address indexed owner, string metadataURI);


    function registerMuse(string calldata name, string calldata metadataURI) external {
        if (_muses[msg.sender].active) revert AlreadyRegistered();
        _validateName(name);
        _validateMetadataURI(metadataURI);

        bytes32 nameHash = keccak256(bytes(name));
        if (_nameOwners[nameHash] != address(0)) revert NameUnavailable();

        uint64 timestamp = uint64(block.timestamp);
        _muses[msg.sender] = Muse(name, metadataURI, timestamp, timestamp, true);
        _nameOwners[nameHash] = msg.sender;
        _owners.push(msg.sender);
        emit MuseRegistered(msg.sender, nameHash, name, metadataURI);
    }

    function updateMuse(string calldata metadataURI) external {
        Muse storage muse = _muses[msg.sender];
        if (!muse.active) revert NotRegistered();
        _validateMetadataURI(metadataURI);
        muse.metadataURI = metadataURI;
        muse.updatedAt = uint64(block.timestamp);
        emit MuseUpdated(msg.sender, metadataURI);
    }


    function museOf(address owner) external view returns (Muse memory) {
        return _muses[owner];
    }

    function ownerOfName(string calldata name) external view returns (address) {
        return _nameOwners[keccak256(bytes(name))];
    }

    function isNameAvailable(string calldata name) external view returns (bool) {
        return _nameOwners[keccak256(bytes(name))] == address(0);
    }

    function totalMuses() external view returns (uint256) {
        return _owners.length;
    }

    function ownerAt(uint256 index) external view returns (address) {
        return _owners[index];
    }

    function _validateName(string calldata name) private pure {
        bytes calldata value = bytes(name);
        if (value.length < 3 || value.length > 32) revert InvalidName();
        for (uint256 i; i < value.length; ++i) {
            bytes1 char = value[i];
            bool allowed = (char >= 0x61 && char <= 0x7a) || (char >= 0x30 && char <= 0x39) || char == 0x2d || char == 0x5f;
            if (!allowed) revert InvalidName();
        }
    }

    function _validateMetadataURI(string calldata metadataURI) private pure {
        uint256 length = bytes(metadataURI).length;
        if (length == 0 || length > 256) revert InvalidMetadataURI();
    }
}
