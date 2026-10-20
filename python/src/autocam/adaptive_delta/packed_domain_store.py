"""Packed physical custody resolving the unchanged canonical snapshot identity."""
from hashlib import sha256
from .domain import canonical,digest,fields
from .native import NativeBackend
from .packed_domain import PackedDomainSnapshot,from_reference_snapshot,verify_packed_partition
from .packed_domain_codec import encode_packed_snapshot,decode_packed_snapshot
from .storage import LocalEpisodeStore


class PackedDomainEpisodeStore(LocalEpisodeStore):
    def __init__(self,directory,backend,*,fault=None):
        if type(backend) is not NativeBackend:raise ValueError('Typed native packed-store backend required')
        super().__init__(directory,fault=fault);self.backend=backend;self._domains={}
        (self.directory/'domain-representations').mkdir(exist_ok=True)

    def _new_service(self,domain,**kwargs):
        from .packed_transition import PackedTransitionService
        return PackedTransitionService(domain,self.backend,**kwargs)

    def _remember(self,ref,descriptor,packed_ref,domain):
        if len(self._domains)>=2 and ref not in self._domains:self._domains.pop(next(iter(self._domains)))
        self._domains[ref]=(descriptor,packed_ref,domain)

    def _put_domain(self,domain):
        if type(domain) is not PackedDomainSnapshot:domain=from_reference_snapshot(domain)
        verify_packed_partition(domain,backend=self.backend)
        ref=domain.canonical_artifact_hash;path=self.directory/'domain-representations'/(ref+'.json')
        if path.exists():
            self._read_domain(ref)
            return ref
        raw=encode_packed_snapshot(domain,backend=self.backend);packed_ref=sha256(raw).hexdigest()
        physical=self.directory/'blocks'/(packed_ref+'.adpk')
        if physical.exists():
            if physical.read_bytes()!=raw:raise ValueError('Existing packed content block is corrupt')
        else:self._atomic(physical,raw)
        descriptor=canonical(dict(schema='adaptive-packed-domain-resolution-1',canonical_snapshot_sha256=ref,
            canonical_recipe='adaptive-snapshot-envelope-1',packed_artifact_sha256=packed_ref,logical_domain_hash=domain.logical_hash))
        self._atomic(path,descriptor);self._remember(ref,descriptor,packed_ref,domain)
        return ref

    def _read_domain(self,ref):
        digest(ref);path=self.directory/'domain-representations'/(ref+'.json')
        if not path.exists():
            # Only actual legacy content blocks are a supported alternate representation.
            return from_reference_snapshot(super()._read_domain(ref))
        from .codec import parse_canonical
        raw_descriptor=path.read_bytes();descriptor=parse_canonical(raw_descriptor)
        fields(descriptor,('schema','canonical_snapshot_sha256','canonical_recipe','packed_artifact_sha256','logical_domain_hash'))
        if (descriptor['schema']!='adaptive-packed-domain-resolution-1' or
            descriptor['canonical_recipe']!='adaptive-snapshot-envelope-1' or descriptor['canonical_snapshot_sha256']!=ref):
            raise ValueError('Invalid packed domain resolution')
        packed_ref=descriptor['packed_artifact_sha256'];digest(packed_ref);digest(descriptor['logical_domain_hash'])
        raw=(self.directory/'blocks'/(packed_ref+'.adpk')).read_bytes()
        if sha256(raw).hexdigest()!=packed_ref:raise ValueError('Packed physical checksum mismatch')
        cached=self._domains.get(ref)
        if cached is not None and cached[:2]==(raw_descriptor,packed_ref):return cached[2]
        domain=decode_packed_snapshot(raw,backend=self.backend)
        if domain.logical_hash!=descriptor['logical_domain_hash'] or domain.canonical_artifact_hash!=ref:
            raise ValueError('Packed canonical snapshot binding differs')
        self._remember(ref,raw_descriptor,packed_ref,domain)
        return domain
